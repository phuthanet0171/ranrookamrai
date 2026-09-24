// The morning message written by AI - and still no invented numbers.
//
//   yesterday + today's forecast (SQL) -> named facts -> Gemini writes a short, friendly LINE
//   message using placeholders only -> checkDraft() -> one rewrite if it broke the rules ->
//   renderDraft() fills in the real values. If the AI fails twice (or is down), the rule-based
//   morningMessage() goes out instead, so the owner always gets a correct message at 8:00.
import { checkDraft, factsForPrompt, renderDraft, type FactSet } from "./factset";
import type { Content, Usage } from "./gemini";
import { textOf } from "./gemini";
import { morningMessage, type Message } from "./automations";
import { shopDayFacts, shopForecastFacts } from "./shopfacts";
import type { DaySummary, Forecast, Shop } from "./shop";

type ModelFn = (body: Record<string, unknown>) => Promise<{ content: Content; model: string; usage: Usage }>;
export type MorningResult = { message: Message; source: "ai" | "template"; model?: string; usage?: Usage; issues?: string[] };

const SYSTEM = [
  "คุณเป็นผู้ช่วยของเจ้าของร้านอาหารเล็ก ๆ เขียนข้อความสรุปตอนเช้าส่งทาง LINE",
  "เขียนภาษาไทยแบบเป็นกันเอง สั้น อ่านบนมือถือง่าย 4–7 บรรทัด ใช้อีโมจิได้เล็กน้อย",
  "เนื้อหา: เมื่อวานขายได้เท่าไหร่ กำไรโดยประมาณ เงินขาดไหม (ถ้ามีข้อมูล) เมนูเด่น แล้วบอกว่าวันนี้ควรเตรียมอะไร จบด้วยคำแนะนำสั้น ๆ 1 ข้อ",
  "กติกาบังคับ:",
  "1. ห้ามพิมพ์ตัวเลขเอง (0-9 หรือเลขไทย) ตัวเลข จำนวนเงิน วันที่ เปอร์เซ็นต์ ต้องเป็น placeholder เช่น {y_day.revenue} คัดลอกให้ตรงตัว",
  "2. ห้ามพิมพ์คำบอกทิศทางเอง (เพิ่มขึ้น ลดลง สูงกว่า ต่ำกว่า มากขึ้น น้อยลง ...) ใช้ {y_day.dir} แทน",
  "3. ใช้เฉพาะ placeholder ที่ให้มา ค่ามีหน่วยอยู่แล้ว ไม่ต้องพิมพ์หน่วยซ้ำ",
  "4. ตอบเป็นข้อความล้วน ไม่ต้องมีหัวเรื่อง ไม่ใช้ markdown",
].join("\n");

export function morningFacts(y: DaySummary, fc: Forecast, sym: string): FactSet {
  const day = shopDayFacts("y", y, sym);
  const f = shopForecastFacts("f", fc);
  return { lang: "th", facts: [...day.facts, ...f.facts] };
}

export async function aiMorningMessage(shop: Shop, sym: string, y: DaySummary, fc: Forecast,
  deps: { model: ModelFn; appUrl?: string }): Promise<MorningResult> {
  const fallback = (issues?: string[]): MorningResult => ({ message: morningMessage(shop, sym, y, fc, deps.appUrl), source: "template", issues });
  if (y.today.revenue === 0) return fallback();                      // nothing recorded: the plain message says so best
  const facts = morningFacts(y, fc, sym);
  const contents: Content[] = [{ role: "user", parts: [{ text: `ร้าน: ${shop.name}\n\nข้อมูล (placeholder = ค่าที่ระบบจะเติม):\n${factsForPrompt(facts)}` }] }];
  const usage: Usage = { input: 0, output: 0 };
  let model: string | undefined;
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let draft: string;
    try {
      const r = await deps.model({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { temperature: 0.4 } });
      usage.input += r.usage.input; usage.output += r.usage.output; model = r.model;
      draft = textOf(r.content);
      contents.push(r.content);
    } catch (e) {
      return { ...fallback([(e as Error).message]), model, usage };
    }
    const check = checkDraft(draft, facts);
    if (check.ok && draft.length > 20) {
      const body = renderDraft(draft, facts).trim() + (deps.appUrl ? `\n\n${deps.appUrl}` : "");
      return { message: { title: `☀️ สรุปเมื่อวาน · ${shop.name}`, body }, source: "ai", model, usage };
    }
    issues = check.ok ? ["ข้อความสั้นเกินไป"] : check.issues;
    contents.push({ role: "user", parts: [{ text: `ข้อความถูกปฏิเสธ: ${issues.join("; ")} เขียนใหม่ทั้งหมดตามกติกา ใช้ placeholder แทนตัวเลขและคำบอกทิศทาง` }] });
  }
  return { ...fallback(issues), model, usage };
}
