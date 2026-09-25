// LINE Messaging API: signature check, reply/push, and the messages the bot sends.
// Env: LINE_CHANNEL_SECRET (webhook signature), LINE_CHANNEL_ACCESS_TOKEN (reply/push),
//      LINE_BOT_ID (optional, "@123abcde" - for the add-friend link in Settings).
import { createHmac, timingSafeEqual } from "node:crypto";
import { count, dateWithDay, money } from "./format";
import type { Parsed } from "./lineparse";
import { salesTotal } from "./lineparse";
import type { DaySummary } from "./shop";

export const lineConfigured = () => Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);

export function addFriendUrl(): string | null {
  const id = process.env.LINE_BOT_ID?.trim();
  return id ? `https://line.me/R/ti/p/${encodeURIComponent(id.startsWith("@") ? id : `@${id}`)}` : null;
}

/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)). */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------- API

export type LineMessage = Record<string, unknown>;

async function call(path: string, body: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN");
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    if (res.status === 429) throw new Error("ส่ง LINE เกินโควตาของเดือนนี้แล้ว (แพ็กเกจฟรี)");
    throw new Error(`LINE ตอบกลับ ${res.status}: ${text}`);
  }
}

export const reply = (replyToken: string, messages: LineMessage[]) => call("reply", { replyToken, messages: messages.slice(0, 5) });
export const push = (to: string, messages: LineMessage[]) => call("push", { to, messages: messages.slice(0, 5) });

export async function profileName(userId: string): Promise<string | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000), cache: "no-store",
    });
    return res.ok ? ((await res.json()) as { displayName?: string }).displayName ?? null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- messages

const QUICK = {
  items: [
    { type: "action", action: { type: "message", label: "📝 จดยอด", text: "จดยอด" } },
    { type: "action", action: { type: "message", label: "✏️ แก้ยอด", text: "แก้ยอด" } },
    { type: "action", action: { type: "message", label: "📊 สรุปวันนี้", text: "สรุปวันนี้" } },
    { type: "action", action: { type: "message", label: "🥘 พรุ่งนี้เตรียมอะไร", text: "พรุ่งนี้ควรเตรียมอะไร" } },
    { type: "action", action: { type: "message", label: "❓ วิธีใช้", text: "วิธีใช้" } },
  ],
};

export const text = (t: string, quick = true): LineMessage => ({ type: "text", text: t.slice(0, 4900), ...(quick ? { quickReply: QUICK } : {}) });

export const HELP = [
  "วิธีใช้ร้านรู้กำไรใน LINE",
  "",
  "📝 จดยอด: พิมพ์ชื่อเมนูตามด้วยจำนวน",
  "  มันไก่ 40, ชาเย็น 20 และไก่ทอด 12",
  "  ใส่เงินและรายจ่ายได้ในข้อความเดียว: สด 3000 โอน 1500 ค่าไก่ 800",
  "  ของเมื่อวาน: เมื่อวาน มันไก่ 35",
  "  แก้จำนวนที่จดแล้ว: ลบข้าวมันไก่ 1 (หรือ ลบเมื่อวานข้าวมันไก่ 1)",
  "  การแก้ยอดจะแสดงรายการเดิมและยอดใหม่ให้กดยืนยัน",
  "  เงินสด = เงินจากยอดขาย ไม่รวมเงินทอนตั้งต้น; ถ้าหยิบไปซื้อของ ให้กรอกยอดก่อนหยิบ",
  "  ระบบจะให้กดยืนยันก่อนบันทึกทุกครั้ง",
  "",
  "💬 ถามอะไรก็ได้: เมื่อวานกำไรเท่าไหร่ / เดือนนี้เมนูไหนขายดี",
  "📊 พิมพ์ \"สรุปวันนี้\" ดูยอดของวันนี้",
].join("\n");

export const NOT_LINKED = [
  "ยังไม่ได้เชื่อม LINE นี้กับร้าน",
  "1. เปิดเว็บร้านรู้กำไร → ตั้งค่า → เชื่อม LINE",
  "2. กด \"สร้างรหัสเชื่อม\" แล้วส่งรหัส 6 หลักมาที่แชตนี้",
].join("\n");

const row = (left: string, right: string, opts: { bold?: boolean; color?: string } = {}) => ({
  type: "box", layout: "horizontal", contents: [
    { type: "text", text: left, size: "sm", color: opts.color ?? "#555555", flex: 5, wrap: true, weight: opts.bold ? "bold" : "regular" },
    { type: "text", text: right, size: "sm", color: opts.color ?? "#111111", flex: 3, align: "end", weight: opts.bold ? "bold" : "regular" },
  ],
});

/** The card the owner confirms before anything is saved. */
export function confirmCard(p: Parsed, draftId: string, date: string, sym: string): LineMessage {
  const lines: Record<string, unknown>[] = [];
  for (const s of p.sales) lines.push(row(`${s.name} × ${count(s.quantity)} ${s.unit}`, money(s.quantity * s.price, sym)));
  if (p.sales.length) lines.push({ type: "separator", margin: "md" }, row("ยอดขายรวม", money(salesTotal(p), sym), { bold: true }));
  if (p.cash !== null || p.transfer !== null) {
    lines.push({ type: "separator", margin: "md" });
    if (p.cash !== null) lines.push(row("เงินสดจากยอดขาย", money(p.cash, sym)));
    if (p.transfer !== null) lines.push(row("เงินโอน", money(p.transfer, sym)));
    if (p.sales.length) {
      const gap = (p.cash ?? 0) + (p.transfer ?? 0) - salesTotal(p);
      lines.push(row(Math.abs(gap) < 1 ? "✓ เงินตรงกับยอดขาย" : gap < 0 ? "⚠️ เงินขาด" : "เงินเกิน", Math.abs(gap) < 1 ? "" : money(Math.abs(gap), sym),
        { color: gap <= -1 ? "#c62828" : "#2e7d32", bold: true }));
    }
  }
  if (p.expenses.length) {
    lines.push({ type: "separator", margin: "md" });
    for (const e of p.expenses) lines.push(row(`รายจ่าย: ${e.description}`, money(e.amount, sym)));
  }
  if (p.unknown.length) {
    lines.push({ type: "separator", margin: "md" },
      { type: "text", text: `❓ ไม่รู้จัก: ${p.unknown.join(", ")}`, size: "xs", color: "#b26a00", wrap: true, margin: "md" },
      { type: "text", text: "ยืนยันแล้วจะบันทึกเฉพาะที่อ่านได้ หรือเพิ่มชื่อเรียกอื่นของเมนูในหน้าตั้งค่า", size: "xxs", color: "#888888", wrap: true });
  }
  return {
    type: "flex",
    altText: `ยืนยันยอด ${dateWithDay(date)}: ${money(salesTotal(p), sym)}`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "ตรวจก่อนบันทึก", weight: "bold", size: "lg" },
        { type: "text", text: `${dateWithDay(date)}${p.by === "ai" ? " · AI ช่วยอ่าน" : ""}`, size: "xs", color: "#888888" },
      ] },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: lines },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "ยกเลิก", data: `cancel:${draftId}`, displayText: "ยกเลิก" } },
        { type: "button", style: "primary", height: "sm", color: "#2563eb", action: { type: "postback", label: "✓ ยืนยัน", data: `confirm:${draftId}`, displayText: "ยืนยัน" } },
      ] },
    },
  };
}

export function correctionCard(name: string, unit: string, removed: number, before: number, after: number,
  amountBefore: number, amountAfter: number, draftId: string, date: string, sym: string): LineMessage {
  return {
    type: "flex", altText: `ยืนยันแก้ยอด ${name} ${count(before)} → ${count(after)} ${unit}`,
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "ตรวจการแก้ยอด", weight: "bold", size: "lg" },
        { type: "text", text: dateWithDay(date), size: "xs", color: "#888888" },
      ] },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        row(name, `ลบ ${count(removed)} ${unit}`),
        row("จำนวนเดิม → ใหม่", `${count(before)} → ${count(after)} ${unit}`, { bold: true }),
        row("ยอดขายเดิม → ใหม่", `${money(amountBefore, sym)} → ${money(amountAfter, sym)}`),
        { type: "text", text: "เงินสด/เงินโอนที่จดไว้ยังเท่าเดิม โปรดตรวจเงินขาด/เกินหลังแก้", size: "xs", color: "#888888", wrap: true },
      ] },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
        { type: "button", style: "secondary", action: { type: "postback", label: "ยกเลิก", data: `cancel:${draftId}`, displayText: "ยกเลิก" } },
        { type: "button", style: "primary", action: { type: "postback", label: "ยืนยันแก้ยอด", data: `confirm:${draftId}`, displayText: "ยืนยัน" } },
      ] },
    },
  };
}

/** After saving, or on "สรุปวันนี้": the day's numbers in a few lines. */
export function dayText(shopName: string, d: DaySummary, sym: string, heading: string): string {
  const t = d.today;
  if (t.revenue === 0 && t.expenses === 0) return `${heading}\n${shopName} · ${dateWithDay(d.date)}\nยังไม่มีการจดยอด`;
  const top = d.menus.filter((m) => m.quantity > 0).slice(0, 3).map((m) => `${m.name} ${count(m.quantity)} ${m.unit}`).join(", ");
  return [
    heading,
    `${shopName} · ${dateWithDay(d.date)}`,
    `ยอดขาย ${money(t.revenue, sym)}`,
    ...(t.gross_profit !== null ? [`กำไรโดยประมาณ ${money(t.gross_profit, sym)}`] : []),
    ...(t.money_gap !== null ? [Math.abs(t.money_gap) < 1 ? "เงินตรงกับยอดขาย ✓" : t.money_gap < 0 ? `⚠️ เงินขาด ${money(-t.money_gap, sym)}` : `เงินเกิน ${money(t.money_gap, sym)}`] : []),
    ...(t.expenses > 0 ? [`รายจ่าย ${money(t.expenses, sym)} · ยอดขายหักรายจ่ายที่จด ${money(t.net_cash, sym)}`] : []),
    ...(top ? [`ขายดี: ${top}`] : []),
  ].join("\n");
}
