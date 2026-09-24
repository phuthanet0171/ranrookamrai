// The assistant: answers a shop owner's question with Gemini function calling.
//
//   question -> Gemini picks tools (never SQL) -> each tool runs a fixed SQL function and returns
//   named facts -> Gemini writes the answer with placeholders only -> checkDraft() -> the code fills
//   in the numbers. If the answer breaks the rules twice, the owner gets the facts themselves
//   instead of AI prose. Every step is recorded in the run log.
import type { DailyReport, DashboardData, LoadedBounds } from "./types";
import type { Content, Part, Usage } from "./gemini";
import { checkDraft, dailyFactSet, factsForPrompt, rangeFactSet, renderDraft, type FactSet } from "./factset";
import type { FactContext } from "./facts";
import { daysBetween, isIsoDate } from "./format";
import { shopDayFacts, shopForecastFacts, shopPeriodFacts } from "./shopfacts";
import type { DaySummary, Forecast, PeriodSummary } from "./shop";
import { rpc } from "./supabase";
import type { Run } from "./runs";

export type AgentScope =
  | { kind: "dataset"; bounds: LoadedBounds; ctx: FactContext; today: string; name: string }
  | { kind: "shop"; shopId: string; name: string; sym: string; today: string };

export type ToolTrace = { name: string; args: Record<string, unknown>; ok: boolean; ms: number; facts: number; error?: string };
export type AgentAnswer = {
  answer: string;
  source: "ai" | "facts" | "none";
  tools: ToolTrace[];
  model?: string;
  note?: string;
};

type ToolEnv = { scope: AgentScope; prefix: string };
export type Tool = {
  name: string;
  description: string;
  params: Record<string, string>;                  // name -> description (all strings, all required)
  run: (args: Record<string, string>, env: ToolEnv) => Promise<FactSet>;
};
export type ModelFn = (body: Record<string, unknown>) => Promise<{ content: Content; model: string; usage: Usage }>;

// ---------------------------------------------------------------- argument checks

function dateArg(v: unknown, scope: AgentScope, name: string): string {
  if (!isIsoDate(v)) throw new Error(`${name} ต้องเป็นวันที่ YYYY-MM-DD`);
  if (scope.kind === "dataset" && (v < scope.bounds.min_date || v > scope.bounds.max_date)) {
    throw new Error(`${name} อยู่นอกช่วงข้อมูล (${scope.bounds.min_date} ถึง ${scope.bounds.max_date})`);
  }
  if (scope.kind === "shop" && v > scope.today) throw new Error(`${name} เป็นวันในอนาคต`);
  return v;
}

function rangeArgs(a: Record<string, string>, scope: AgentScope) {
  const start = dateArg(a.start, scope, "start"), end = dateArg(a.end, scope, "end");
  if (start > end) throw new Error("start ต้องไม่อยู่หลัง end");
  if (daysBetween(start, end) > 366) throw new Error("ช่วงวันที่ยาวเกิน 1 ปี");
  return { start, end };
}

/** Prefix fact ids so facts from several tool calls never collide: revenue -> t1_revenue. */
function prefixed(set: FactSet, p: string): FactSet {
  return { ...set, facts: set.facts.map((f) => ({ ...f, id: `${p}_${f.id}` })) };
}

// ---------------------------------------------------------------- tools

export const DATASET_TOOLS: Tool[] = [
  {
    name: "sales_summary",
    description: "ภาพรวมยอดขายช่วงวันที่ที่กำหนด เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน: รายได้ คำสั่งซื้อ ลูกค้า หมวดสินค้าขายดี สินค้าขายดี ชั่วโมง/วันที่ขายดี และส่วนที่ทำให้รายได้เปลี่ยน",
    params: { start: "วันเริ่ม YYYY-MM-DD", end: "วันสุดท้าย YYYY-MM-DD" },
    async run(a, env) {
      if (env.scope.kind !== "dataset") throw new Error("ใช้ได้เฉพาะชุดข้อมูลวิเคราะห์");
      const { start, end } = rangeArgs(a, env.scope);
      const d = await rpc<DashboardData>("dashboard_data", { p_start: start, p_end: end });
      return prefixed(rangeFactSet(d, "th", env.scope.ctx), env.prefix);
    },
  },
  {
    name: "daily_report",
    description: "สรุปของวันเดียว เทียบกับค่าเฉลี่ย 7 วันก่อน วันก่อนหน้า และวันเดียวกันของสัปดาห์ก่อน พร้อมยอดสะสมเดือนนั้น",
    params: { date: "วันที่ YYYY-MM-DD" },
    async run(a, env) {
      if (env.scope.kind !== "dataset") throw new Error("ใช้ได้เฉพาะชุดข้อมูลวิเคราะห์");
      const date = dateArg(a.date, env.scope, "date");
      const r = await rpc<DailyReport>("daily_report", { p_date: date });
      return prefixed(dailyFactSet(r, "th", env.scope.ctx), env.prefix);
    },
  },
];

export const SHOP_TOOLS: Tool[] = [
  {
    name: "shop_day",
    description: "ตัวเลขของร้านในวันเดียว: ยอดขาย กำไรโดยประมาณ เงินสด/เงินโอน เงินขาดหรือเกิน รายจ่าย เงินสุทธิ และขายเมนูอะไรไปเท่าไหร่ เทียบกับวันเดียวกันของสัปดาห์ก่อน",
    params: { date: "วันที่ YYYY-MM-DD" },
    async run(a, env) {
      if (env.scope.kind !== "shop") throw new Error("ใช้ได้เฉพาะร้าน");
      const date = dateArg(a.date, env.scope, "date");
      const d = await rpc<DaySummary>("shop_day_summary", { p_shop: env.scope.shopId, p_date: date });
      return shopDayFacts(env.prefix, d, env.scope.sym);
    },
  },
  {
    name: "shop_period",
    description: "ภาพรวมของร้านช่วงวันที่ที่กำหนด เทียบกับช่วงก่อนหน้า: ยอดขาย กำไร รายจ่าย เงินขาด เมนูไหนทำเงินและอัตรากำไรต่อเมนู วันไหนขายดี รายจ่ายหมวดไหนมาก",
    params: { start: "วันเริ่ม YYYY-MM-DD", end: "วันสุดท้าย YYYY-MM-DD" },
    async run(a, env) {
      if (env.scope.kind !== "shop") throw new Error("ใช้ได้เฉพาะร้าน");
      const { start, end } = rangeArgs(a, env.scope);
      const s = await rpc<PeriodSummary>("shop_period_summary", { p_shop: env.scope.shopId, p_start: start, p_end: end });
      return shopPeriodFacts(env.prefix, s, env.scope.sym);
    },
  },
  {
    name: "shop_forecast",
    description: "คาดการณ์ว่าวันที่ระบุควรเตรียมแต่ละเมนูประมาณเท่าไหร่ จากวันเดียวกันใน 4 สัปดาห์ล่าสุด (ใช้กับวันพรุ่งนี้หรือวันในอนาคตได้)",
    params: { date: "วันที่ต้องการคาดการณ์ YYYY-MM-DD" },
    async run(a, env) {
      if (env.scope.kind !== "shop") throw new Error("ใช้ได้เฉพาะร้าน");
      if (!isIsoDate(a.date)) throw new Error("date ต้องเป็นวันที่ YYYY-MM-DD");
      if (daysBetween(env.scope.today, a.date) > 14) throw new Error("คาดการณ์ได้ไม่เกิน 14 วันข้างหน้า");
      const f = await rpc<Forecast>("shop_forecast", { p_shop: env.scope.shopId, p_date: a.date });
      return shopForecastFacts(env.prefix, f);
    },
  },
];

const declarations = (tools: Tool[]) => [{
  functionDeclarations: tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "OBJECT",
      properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "STRING", description: d }])),
      required: Object.keys(t.params),
    },
  })),
}];

// ---------------------------------------------------------------- prompt

function systemPrompt(scope: AgentScope): string {
  const where = scope.kind === "shop"
    ? `ร้าน “${scope.name}” วันนี้คือ ${scope.today} (เวลาประเทศไทย) ข้อมูลเป็นยอดที่ร้านจดรายวันต่อเมนู`
    : `ชุดข้อมูล “${scope.name}” มีข้อมูลตั้งแต่ ${scope.bounds.min_date} ถึง ${scope.bounds.max_date} ` +
      `ให้ถือว่า “วันนี้” คือ ${scope.today} และ “เมื่อวาน” คือวันก่อนหน้านั้น`;
  return [
    "คุณคือผู้ช่วยวิเคราะห์ยอดขายของเจ้าของร้าน ตอบเป็นภาษาไทยที่สุภาพ กระชับ อ่านง่าย",
    where,
    "ขั้นตอน: ใช้เครื่องมือ (tools) เพื่อดึงข้อมูลเสมอก่อนตอบเรื่องตัวเลข คำนวณช่วงวันที่เองจากวันนี้ได้ (เช่น 7 วันล่าสุด เดือนนี้)",
    "ผลของเครื่องมือเป็นรายการ placeholder เช่น {t1_revenue.now} = ฿ 1,000 พร้อมค่าที่ระบบจะเติมให้",
    "กติกาบังคับ (ผิดแล้วคำตอบจะถูกทิ้ง):",
    "1. ห้ามพิมพ์ตัวเลขเองเลย (0-9 หรือเลขไทย) ตัวเลข วันที่ จำนวนเงิน เปอร์เซ็นต์ ต้องเป็น placeholder ที่คัดลอกมาตรงตัว",
    "2. ห้ามพิมพ์คำบอกทิศทางเอง (เพิ่มขึ้น ลดลง สูงกว่า ต่ำกว่า มากขึ้น น้อยลง ...) ให้ใช้ placeholder {x.dir} แทน",
    "3. ใช้เฉพาะ placeholder ที่มีอยู่ในผลของเครื่องมือ และใช้กับเรื่องที่มันเป็นของจริง ค่ามีหน่วยอยู่แล้ว ไม่ต้องพิมพ์หน่วยซ้ำ",
    "   ใช้ {x.dir} หรือ {x.cmp} อย่างใดอย่างหนึ่งในประโยค ห้ามใช้คู่กัน มีแค่ {x.amount} ที่เป็นผลต่าง ค่าอื่นเป็นยอดรวม",
    "4. ห้ามเดาสาเหตุ ข้อมูลบอกได้ว่าอะไรเปลี่ยน ไม่ได้บอกว่าทำไม ถ้าจะแนะนำให้บอกว่าเป็นสิ่งที่ควรลองตรวจ",
    "5. ถ้าคำถามไม่เกี่ยวกับยอดขาย/กำไร/เมนู/ร้าน หรือเครื่องมือที่มีตอบไม่ได้ ให้เรียก cannot_answer ทันที ห้ามดึงข้อมูลมาตอบแทน",
    "6. ตอบสั้น: ประโยคสรุป 1 ประโยค ตามด้วยข้อสำคัญไม่เกิน 4 ข้อ (ขึ้นต้นด้วย • ) ไม่ต้องใส่หัวข้อ",
  ].join("\n");
}

// ---------------------------------------------------------------- the loop

const MAX_ROUNDS = 4;
const REFUSAL = "ถามได้เฉพาะเรื่องยอดขายของร้าน เช่น ยอดขายหรือกำไรช่วงไหน เมนูไหนขายดีหรือทำกำไร เงินขาดไหม หรือพรุ่งนี้ควรเตรียมอะไร";

/** Always offered: lets the model decline explicitly instead of answering something off-topic with data. */
const CANNOT_ANSWER: Tool = {
  name: "cannot_answer",
  description: "ใช้เมื่อคำถามไม่เกี่ยวกับยอดขายของร้าน หรือเครื่องมืออื่นตอบไม่ได้",
  params: { reason: "เหตุผลสั้น ๆ" },
  async run() { return { lang: "th", facts: [] }; },
};
const MAX_CALLS_PER_ROUND = 3;

export async function runAgent(question: string, scope: AgentScope, deps: { model: ModelFn; tools?: Tool[]; run?: Run }): Promise<AgentAnswer> {
  const tools = [...(deps.tools ?? (scope.kind === "shop" ? SHOP_TOOLS : DATASET_TOOLS)), CANNOT_ANSWER];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const traces: ToolTrace[] = [];
  const allFacts: FactSet = { lang: "th", facts: [] };
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  const base = { systemInstruction: { parts: [{ text: systemPrompt(scope) }] }, tools: declarations(tools), generationConfig: { temperature: 0.2 } };
  let model: string | undefined;
  let callNo = 0;
  let text = "";

  const ask = async (label: string, mode: "ANY" | "AUTO" | "NONE") => {
    const call = () => deps.model({ ...base, contents, toolConfig: { functionCallingConfig: { mode } } });
    const res = deps.run ? await deps.run.step(label, call, (r) => `${r.model} · ${r.usage.input}+${r.usage.output} tokens`) : await call();
    model = res.model;
    deps.run?.ai(res.model, res.usage);
    return res.content;
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // round 1 must pick a tool (data or cannot_answer), so the AI cannot answer from memory
    const content = await ask(`AI round ${round}`, round === 1 ? "ANY" : round < MAX_ROUNDS ? "AUTO" : "NONE");
    const calls = content.parts.filter((p) => p.functionCall).slice(0, MAX_CALLS_PER_ROUND);
    if (calls.some((p) => p.functionCall!.name === "cannot_answer") && allFacts.facts.length === 0) {
      const reason = String(calls.find((p) => p.functionCall!.name === "cannot_answer")!.functionCall!.args?.reason ?? "");
      traces.push({ name: "cannot_answer", args: { reason }, ok: true, ms: 0, facts: 0 });
      deps.run?.note("cannot_answer", reason);
      return { answer: REFUSAL, source: "none", tools: traces, model, note: reason || undefined };
    }
    if (calls.length === 0) { text = content.parts.map((p) => p.text ?? "").join("").trim(); break; }
    contents.push(content);
    const responses: Part[] = [];
    for (const p of calls) {
      const { name, args = {} } = p.functionCall!;
      const tool = byName.get(name);
      const prefix = `t${++callNo}`;
      const strArgs = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)]));
      const t0 = performance.now();
      try {
        if (!tool) throw new Error(`ไม่มีเครื่องมือชื่อ ${name}`);
        const set = await tool.run(strArgs, { scope, prefix });
        allFacts.facts.push(...set.facts);
        traces.push({ name, args, ok: true, ms: Math.round(performance.now() - t0), facts: set.facts.length });
        deps.run?.note(`tool ${name}`, `${JSON.stringify(args)} → ${set.facts.length} facts`);
        responses.push({ functionResponse: { name, response: { facts: factsForPrompt(set) } } });
      } catch (e) {
        const error = (e as Error).message;
        traces.push({ name, args, ok: false, ms: Math.round(performance.now() - t0), facts: 0, error });
        deps.run?.note(`tool ${name} ผิดพลาด`, `${JSON.stringify(args)} → ${error}`);
        responses.push({ functionResponse: { name, response: { error } } });
      }
    }
    contents.push({ role: "user", parts: responses });
  }

  let check = checkDraft(text, allFacts);
  deps.run?.note("check answer", check.ok ? "ผ่าน: ใช้แต่ช่องว่าง" : `ไม่ผ่าน: ${check.issues.join("; ")}`);
  if (!check.ok && text) {
    contents.push({ role: "model", parts: [{ text }] });
    contents.push({ role: "user", parts: [{ text:
      `คำตอบถูกปฏิเสธ: ${check.issues.join("; ")} เขียนใหม่ตามกติกาบังคับ ใช้ placeholder เท่านั้น ไม่ต้องเรียกเครื่องมือเพิ่ม` }] });
    const content = await ask("AI rewrite", "NONE");
    text = content.parts.map((p) => p.text ?? "").join("").trim();
    check = checkDraft(text, allFacts);
    deps.run?.note("check rewrite", check.ok ? "ผ่าน" : `ไม่ผ่าน: ${check.issues.join("; ")}`);
  }

  if (text && check.ok) {
    return { answer: renderDraft(text, allFacts), source: "ai", tools: traces, model };
  }
  if (allFacts.facts.length === 0) {
    return { answer: REFUSAL, source: "none", tools: traces, model,
      note: text ? "คำตอบของ AI ผิดกติกา จึงไม่แสดง" : undefined };
  }
  // AI prose was rejected: show the facts the tools found, rendered by the code
  const lines = allFacts.facts.slice(0, 8).map((f) => `• ${f.about}: ${Object.values(f.values).slice(0, 4).join(" · ")}`);
  return {
    answer: ["AI เรียบเรียงคำตอบไม่ผ่านการตรวจ จึงแสดงข้อมูลที่ระบบดึงมาแทน", ...lines].join("\n"),
    source: "facts", tools: traces, model, note: check.issues.join("; "),
  };
}
