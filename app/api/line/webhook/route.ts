// POST /api/line/webhook  - LINE Messaging API webhook (set it in LINE Developers console).
//
//   "123456"                      -> link this LINE user to the shop that made the code
//   "มันไก่ 40 ชาเย็น 20 สด 1200"   -> rules (+ AI when needed) read it -> draft -> card with ยืนยัน/ยกเลิก
//   ยืนยัน (postback)              -> line_draft_confirm(): the entry is saved exactly once
//   "เมื่อวานกำไรเท่าไหร่"          -> the same AI assistant as the web (numbers filled from SQL)
//   "สรุปวันนี้" / "วิธีใช้"         -> fixed replies, no AI
// Only requests signed with LINE_CHANNEL_SECRET are processed. Every event is logged in /runs.
import { runAgent } from "@/lib/agent";
import { addDays, currencySymbol } from "@/lib/format";
import { gemini, textOf } from "@/lib/gemini";
import { dayText, HELP, lineConfigured, NOT_LINKED, profileName, reply, text, confirmCard, correctionCard, verifySignature, type LineMessage } from "@/lib/line";
import { AI_PARSE_SCHEMA, aiParsePrompt, checkAiParse, isEmpty, looksLikeQuestion, looksLikeCorrection, parseCorrection, parseRecord, toEntry, type Parsed } from "@/lib/lineparse";
import { hit } from "@/lib/ratelimit";
import { startRun, type Run } from "@/lib/runs";
import { daySummary, getMenu, isUuid, listShops, todayBangkok, type Shop } from "@/lib/shop";
import { insert, rpc, select, supabaseConfigured, update } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
  postback?: { data?: string };
};

const PER_USER = { max: 40, windowMs: 10 * 60_000 };

async function shopOf(userId: string): Promise<Shop | null> {
  const [link] = await select<{ shop_id: string }>("line_links", `line_user_id=eq.${encodeURIComponent(userId)}&select=shop_id`);
  if (!link) return null;
  return (await listShops()).find((s) => s.id === link.shop_id) ?? null;
}

/** Rules first; AI only for words the rules did not know, and only what the message supports. */
async function readRecord(msg: string, shop: Shop, run: Run): Promise<Parsed> {
  const menu = await run.step("menu", () => getMenu(shop.id), (m) => `${m.length} เมนู`);
  const rules = parseRecord(msg, menu);
  run.note("rules", `เมนู ${rules.sales.length} · รายจ่าย ${rules.expenses.length} · ไม่รู้จัก ${rules.unknown.length}`);
  if (rules.unknown.length === 0 || !process.env.GEMINI_API_KEY) return rules;
  try {
    const p = aiParsePrompt(msg, menu);
    const r = await run.step("ai parse", () => gemini({
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: "user", parts: [{ text: p.user }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: AI_PARSE_SCHEMA },
    }), (x) => x.model);
    run.ai(r.model, r.usage);
    const ai = checkAiParse(JSON.parse(textOf(r.content)), msg, menu);
    const found = (x: Parsed) => x.sales.length + x.expenses.length + (x.cash !== null ? 1 : 0) + (x.transfer !== null ? 1 : 0);
    if (ai && found(ai) >= found(rules)) {
      run.note("ai check", `ใช้ผลจาก AI (${found(ai)} รายการ, ไม่รู้จัก ${ai.unknown.length})`);
      return ai;
    }
    run.note("ai check", "AI ไม่ได้อ่านเพิ่มจากกฎ ใช้ผลจากกฎ");
  } catch (e) {
    run.note("ai parse", `ใช้ผลจากกฎ: ${(e as Error).message}`);
  }
  return rules;
}

async function onText(userId: string, msg: string, run: Run): Promise<LineMessage[]> {
  const code = msg.match(/^\s*(?:เชื่อม(?:ร้าน)?\s*)?(\d{6})\s*$/);
  if (code) {
    const name = await profileName(userId);
    const shopId = await run.step("link", () => rpc<string | null>("line_link_claim", { p_code: code[1], p_user: userId, p_name: name }), (x) => (x ? "เชื่อมแล้ว" : "รหัสไม่ถูกต้อง"));
    if (!shopId) return [text("รหัสไม่ถูกต้องหรือหมดอายุ (ใช้ได้ 15 นาที) สร้างรหัสใหม่ได้ที่ ตั้งค่า → เชื่อม LINE", false)];
    run.setShop(shopId);
    const shop = (await listShops()).find((s) => s.id === shopId);
    return [text(`✅ เชื่อมกับร้าน ${shop?.name ?? ""} แล้ว\n\n${HELP}`)];
  }

  const shop = await shopOf(userId);
  if (!shop) return [text(NOT_LINKED, false)];
  run.setShop(shop.id);
  const sym = currencySymbol(shop.currency);
  const today = todayBangkok();
  const m = msg.trim();

  if (/^(วิธีใช้|ช่วยเหลือ|ช่วยด้วย|help|เมนู|\?)$/i.test(m)) return [text(HELP)];
  if (m === "จดยอด") return [text("พิมพ์หลายเมนูในข้อความเดียวได้ เช่น ขายมันไก่ 40, ชาเย็น 20 สด 2500 โอน 1500 ค่าไก่ 800 แล้วตรวจการ์ดก่อนกดยืนยัน")];
  if (m === "แก้ยอด") return [text("พิมพ์ชื่อเมนูและจำนวนที่ต้องการลด เช่น ลบข้าวมันไก่ 1 หรือ ลบเมื่อวาน ข้าวมันไก่ 2 แล้วกดยืนยันในการ์ด")];
  if (/^(ยืนยัน|ยกเลิก)$/.test(m)) return [];                          // echo of a button tap
  if (/^(สรุป|สรุปวันนี้|ยอดวันนี้|วันนี้)$/.test(m)) {
    return [text(dayText(shop.name, await daySummary(shop.id, today), sym, "📊 สรุปวันนี้"))];
  }

  if (looksLikeCorrection(m)) {
    const menu = await getMenu(shop.id);
    const correction = parseCorrection(m, menu);
    if (!correction) return [text("แก้ยอดได้ทีละเมนู พิมพ์เช่น ลบข้าวมันไก่ 1 หรือ ลบเมื่อวานข้าวมันไก่ 1 ใช้ชื่อเมนู/ชื่อเรียกในตั้งค่า")];
    const date = correction.day === "yesterday" ? addDays(today, -1) : today;
    const preview = await rpc<{ entry_id: string; quantity: number; remaining: number; amount_before: number; amount_after: number } | null>(
      "line_correction_preview", { p_user: userId, p_date: date, p_menu: correction.menu_item_id, p_quantity: correction.quantity });
    if (!preview) return [text(`ไม่พบรายการ ${correction.name} ที่จดในวันนั้นและมีจำนวนพอให้ลบ กรุณาตรวจยอดเดิมก่อน`)];
    const [draft] = await insert<{ id: string }>("entry_drafts", [{
      shop_id: shop.id, author: "LINE", raw_text: m.slice(0, 1000), line_user_id: userId, entry_date: date,
      parsed: { kind: "decrement", entry_id: preview.entry_id, menu_item_id: correction.menu_item_id,
        quantity: correction.quantity, expected_quantity: preview.quantity },
    }]);
    return [correctionCard(correction.name, correction.unit, correction.quantity, preview.quantity, preview.remaining,
      preview.amount_before, preview.amount_after, draft.id, date, sym)];
  }

  if (looksLikeQuestion(m)) {
    if (!process.env.GEMINI_API_KEY) return [text("ยังถาม AI ไม่ได้ (ไม่ได้ตั้งค่า GEMINI_API_KEY)")];
    const answer = await runAgent(m.slice(0, 400), { kind: "shop", shopId: shop.id, name: shop.name, sym, today }, { model: gemini, run });
    return [text(answer.answer)];
  }

  const parsed = await readRecord(m, shop, run);
  if (parsed.unknown.length) return [text(`ยังอ่านบางรายการไม่ชัด: ${parsed.unknown.join(", ").slice(0, 300)}\nยังไม่บันทึกอะไร กรุณาแก้ชื่อเมนูหรือแยกรายการด้วยช่องว่าง/จุลภาค แล้วส่งใหม่`)];
  if (isEmpty(parsed)) {
    return [text(`อ่านไม่ออกว่าขายอะไรไปบ้าง${parsed.unknown.length ? ` (ไม่รู้จัก: ${parsed.unknown.join(", ")})` : ""}\nพิมพ์ชื่อเมนูตามด้วยจำนวน เช่น มันไก่ 40 ชาเย็น 20\nหรือเพิ่มชื่อเรียกอื่นของเมนูในหน้าตั้งค่า`)];
  }
  const date = parsed.day === "yesterday" ? addDays(today, -1) : today;
  const [draft] = await run.step("draft", () => insert<{ id: string }>("entry_drafts", [{
    shop_id: shop.id, author: "LINE", raw_text: m.slice(0, 1000), parsed: toEntry(parsed), line_user_id: userId, entry_date: date,
  }]), () => "รอยืนยัน");
  return [confirmCard(parsed, draft.id, date, sym)];
}

async function onPostback(userId: string, data: string, run: Run): Promise<LineMessage[]> {
  const [action, id] = data.split(":");
  if (!isUuid(id)) return [];
  const shop = await shopOf(userId);
  if (!shop) return [text(NOT_LINKED, false)];
  run.setShop(shop.id);
  if (action === "cancel") {
    await update("entry_drafts", `id=eq.${id}&line_user_id=eq.${encodeURIComponent(userId)}&status=eq.pending`, { status: "cancelled", resolved_at: new Date().toISOString() });
    return [text("ยกเลิกแล้ว ไม่ได้บันทึก")];
  }
  if (action !== "confirm") return [];
  const entry = await run.step("confirm", () => rpc<string | null>("line_draft_confirm", { p_draft: id, p_user: userId }), (x) => (x ? "บันทึกแล้ว" : "บันทึกไปแล้วหรือหมดอายุ"));
  if (!entry) return [text("รายการนี้บันทึกไปแล้ว ยกเลิกไปแล้ว หรือหมดอายุ (เกิน 1 วัน)")];
  const [d] = await select<{ entry_date: string; parsed: { kind?: string } }>("entry_drafts", `id=eq.${id}&select=entry_date,parsed`);
  const day = await daySummary(shop.id, d?.entry_date ?? todayBangkok());
  return [text(dayText(shop.name, day, currencySymbol(shop.currency), d?.parsed?.kind === "decrement" ? "✅ แก้ยอดแล้ว" : "✅ บันทึกแล้ว"))];
}

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!lineConfigured() || !secret) return Response.json({ error: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN" }, { status: 500 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-line-signature"), secret)) return Response.json({ error: "bad signature" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 500 });

  const events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []).slice(0, 10);   // "Verify" sends none
  for (const ev of events) {
    const userId = ev.source?.userId;
    if (!userId || !ev.replyToken) continue;
    if (hit(`line:${userId}`, PER_USER)) {
      await reply(ev.replyToken, [text("ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่นะ", false)]).catch(() => undefined);
      continue;
    }
    const title = ev.type === "message" ? (ev.message?.text ?? `[${ev.message?.type}]`).slice(0, 120) : ev.type === "postback" ? `กด ${ev.postback?.data?.split(":")[0]}` : ev.type;
    const run = startRun("line", ev.type, { title });
    try {
      let out: LineMessage[] = [];
      if (ev.type === "message" && ev.message?.type === "text" && ev.message.text) {
        out = await onText(userId, ev.message.text, run);
      } else if (ev.type === "message") {
        out = [text("ตอนนี้อ่านได้เฉพาะข้อความ พิมพ์ชื่อเมนูตามด้วยจำนวน เช่น มันไก่ 40")];
      } else if (ev.type === "postback" && ev.postback?.data) {
        out = await onPostback(userId, ev.postback.data, run);
      } else if (ev.type === "follow") {
        const shop = await shopOf(userId);
        out = [text(shop ? `ยินดีต้อนรับกลับ 👋\n\n${HELP}` : `สวัสดี 👋 ร้านรู้กำไรช่วยจดยอด คิดกำไร และสรุปให้ทุกเช้า\n\n${NOT_LINKED}`, Boolean(shop))];
      }
      if (out.length) await run.step("reply", () => reply(ev.replyToken!, out), () => `${out.length} ข้อความ`);
      await run.finish("success", { output: { replies: out.length } });
    } catch (e) {
      await reply(ev.replyToken, [text(`ขอโทษ ระบบขัดข้อง ลองใหม่อีกครั้ง (${(e as Error).message.slice(0, 80)})`, false)]).catch(() => undefined);
      await run.finish("failed", { error: (e as Error).message });
    }
  }
  return Response.json({ ok: true });
}
