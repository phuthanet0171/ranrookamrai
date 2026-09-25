// Reads a LINE message like "มันไก่ 40 ชาเย็น 20 ค่าไก่ 800 สด 3000 โอน 1500" into an entry.
//
// 1. parseRecord(): plain rules, no AI - menu names/aliases, cash, transfer, "ค่า..." expenses.
// 2. aiParse(): only when the rules leave words they do not know. Gemini maps the text onto
//    the menu, then checkAiParse() throws away anything that is not grounded in the message:
//    every number must be one the owner typed, every menu must exist.
// Nothing is saved from either: the owner confirms the result in LINE first.
import type { MenuItem } from "./shop";

export type ParsedSale = { menu_item_id: string; name: string; unit: string; quantity: number; price: number };
export type ParsedExpense = { category: string; description: string; amount: number };
export type Parsed = {
  day: "today" | "yesterday";
  sales: ParsedSale[];
  cash: number | null;
  transfer: number | null;
  expenses: ParsedExpense[];
  unknown: string[];                 // "label number" pairs the rules could not place
  by: "rules" | "ai";
};
export type Correction = { day: "today" | "yesterday"; menu_item_id: string; name: string; unit: string; quantity: number };

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const UNITS = ["จาน", "แก้ว", "ถ้วย", "ชาม", "ที่", "ชิ้น", "กล่อง", "ถุง", "ขวด", "ไม้", "ลูก", "อัน", "ห่อ", "ชุด", "บาท", "฿", "x", "×", "=", ":"];
const CASH = /^(เงินสด|สด|cash)$/;
const TRANSFER = /^(เงินโอน|โอน|พร้อมเพย์|พร้อมเพ|qr|คิวอาร์|transfer)$/i;
const EXPENSE = /^(ค่า|จ่าย|ซื้อ)(.*)$/;

export const EXPENSE_CATEGORIES = ["วัตถุดิบ", "แก๊สและน้ำแข็ง", "ค่าแรง", "ค่าเช่า", "ค่าน้ำค่าไฟ", "บรรจุภัณฑ์", "อื่น ๆ"];

function expenseCategory(what: string): string {
  if (/แก๊ส|น้ำแข็ง/.test(what)) return "แก๊สและน้ำแข็ง";
  if (/แรง|ลูกจ้าง|พนักงาน|จ้าง/.test(what)) return "ค่าแรง";
  if (/เช่า|ที่/.test(what) && what.length <= 4) return "ค่าเช่า";
  if (/ไฟ|น้ำประปา|ค่าน้ำ|เน็ต/.test(what) || what === "น้ำ") return "ค่าน้ำค่าไฟ";
  if (/ถุง|กล่อง|แก้ว|หลอด|ช้อน|บรรจุ/.test(what)) return "บรรจุภัณฑ์";
  return "วัตถุดิบ";
}

export function normalize(text: string): string {
  return text
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/(\d),(?=\d{3}\b)/g, "$1")                    // 1,500 -> 1500
    .replace(/\s+/g, " ")
    .trim();
}

/** Every number the owner typed - the AI may only use these. */
export function numbersIn(text: string): Set<number> {
  return new Set((normalize(text).match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
}

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function cleanLabel(raw: string): string {
  let s = raw.replace(/[,\n;/+]+/g, " ").trim();
  s = s.replace(/^(?:(?:และ|กับ|ขาย|จด|เพิ่ม|บวก|อีก|จำนวน|รายการ)\s*)+/g, "").trim();
  let changed = true;
  while (changed) {                                         // "ข้าวมันไก่ x", "40 จาน ชาเย็น" leftovers
    changed = false;
    for (const u of UNITS) {
      const symbol = u.length === 1;                        // "x", "=", "฿" may touch the word; unit words need a space
      if (s === u || s.startsWith(u + " ") || (symbol && s.startsWith(u))) { s = s.slice(u.length).trim(); changed = true; }
      if (s.endsWith(" " + u) || (symbol && s.endsWith(u) && s.length > 1)) { s = s.slice(0, -u.length).trim(); changed = true; }
    }
  }
  return s;
}

/** Menu lookup: exact name/alias first, then (unless exactOnly) the longest name/alias the label contains. */
export function matchMenu(label: string, menu: MenuItem[], exactOnly = false): MenuItem | null {
  const l = squash(label);
  if (!l) return null;
  const names = menu.filter((m) => m.active).flatMap((m) => [m.name, ...m.aliases].map((n) => ({ m, n: squash(n) })));
  const exact = names.filter((x) => x.n === l);
  if (exact.length) return exact[0].m;
  if (exactOnly) return null;
  const inside = names.filter((x) => x.n.length >= 2 && l.includes(x.n)).sort((a, b) => b.n.length - a.n.length);
  if (inside.length && (inside.length === 1 || inside[0].n.length > inside[1].n.length || inside[0].m.id === inside[1].m.id)) return inside[0].m;
  return null;
}

/** A question for the assistant rather than numbers to record. */
export const looksLikeQuestion = (text: string) =>
  /[?？]|ไหม|มั้ย|หรือเปล่า|เท่าไ|อะไร|กี่|ยังไง|อย่างไร|ไหน|ทำไม|ควร|แนะนำ/.test(text) || !/[\d๐-๙]/.test(text);

/** A correction targets a recorded sale. Never pass it to the ordinary positive-sale parser or AI. */
export function parseCorrection(text: string, menu: MenuItem[]): Correction | null {
  const t = normalize(text);
  const m = t.match(/^(?:แก้ยอด\s*)?(?:ลบ|ลด|หัก)\s*(?:ยอด\s*)?(?:(เมื่อวาน|วันนี้)\s*)?(.+?)\s+(\d+(?:\.\d+)?)\s*(?:จาน|แก้ว|ถ้วย|ชาม|ที่|ชิ้น|กล่อง|ถุง|ขวด|ไม้|ลูก|อัน|ห่อ|ชุด)?$/);
  if (!m) return null;
  const item = matchMenu(m[2], menu, true);
  const quantity = Number(m[3]);
  if (!item || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) return null;
  return { day: m[1] === "เมื่อวาน" ? "yesterday" : "today", menu_item_id: item.id, name: item.name, unit: item.unit, quantity };
}

export const looksLikeCorrection = (text: string) => /^(?:แก้ยอด\s*)?(?:ลบ|ลด|หัก)/.test(normalize(text));

export function parseRecord(text: string, menu: MenuItem[]): Parsed {
  const t = normalize(text).replace(/[,;|+]+/g, " ").replace(/\s+(?:และ|กับ)\s+/g, " ");
  const out: Parsed = { day: /เมื่อวาน/.test(t) ? "yesterday" : "today", sales: [], cash: null, transfer: null, expenses: [], unknown: [], by: "rules" };
  const body = t.replace(/(ของ)?เมื่อวาน(นี้)?|(ของ)?วันนี้|ยอด(ขาย)?|จด(ยอด)?/g, " ");
  const sales = new Map<string, ParsedSale>();
  for (const m of body.matchAll(/([^\d]+?)\s*(\d+(?:\.\d+)?)/g)) {
    const label = cleanLabel(m[1]);
    const value = Number(m[2]);
    if (!label || !Number.isFinite(value)) continue;
    if (CASH.test(label)) { out.cash = (out.cash ?? 0) + value; continue; }
    if (TRANSFER.test(label)) { out.transfer = (out.transfer ?? 0) + value; continue; }
    // "ค่าไก่ 800" is an expense even when a menu is called "ไก่..." - unless it is exactly a menu name
    const exp = label.match(EXPENSE);
    const item = matchMenu(label, menu, Boolean(exp));
    if (item) {
      const prev = sales.get(item.id);
      sales.set(item.id, { menu_item_id: item.id, name: item.name, unit: item.unit, price: Number(item.price), quantity: (prev?.quantity ?? 0) + value });
      continue;
    }
    if (exp && value > 0) {
      const what = exp[2].trim() || label;
      out.expenses.push({ category: expenseCategory(what), description: label, amount: value });
      continue;
    }
    out.unknown.push(`${label} ${m[2]}`);
  }
  out.sales = [...sales.values()];
  return out;
}

export const isEmpty = (p: Parsed) => p.sales.length === 0 && p.expenses.length === 0 && p.cash === null && p.transfer === null;

export const salesTotal = (p: Parsed) => p.sales.reduce((s, x) => s + x.quantity * x.price, 0);

/** The entry payload for shop_record_day(). */
export function toEntry(p: Parsed) {
  return {
    sales: p.sales.map((s) => ({ menu_item_id: s.menu_item_id, quantity: s.quantity })),
    ...(p.cash !== null ? { cash: p.cash } : {}),
    ...(p.transfer !== null ? { transfer: p.transfer } : {}),
    expenses: p.expenses.map((e) => ({ category: e.category, description: e.description, amount: e.amount })),
    note: "จดผ่าน LINE",
  };
}

// ---------------------------------------------------------------- AI fallback

export const AI_PARSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    day: { type: "STRING", enum: ["today", "yesterday"] },
    sales: { type: "ARRAY", items: { type: "OBJECT", properties: { menu: { type: "STRING" }, quantity: { type: "NUMBER" } }, required: ["menu", "quantity"] } },
    cash: { type: "NUMBER", nullable: true },
    transfer: { type: "NUMBER", nullable: true },
    expenses: { type: "ARRAY", items: { type: "OBJECT", properties: {
      description: { type: "STRING" }, category: { type: "STRING", enum: EXPENSE_CATEGORIES }, amount: { type: "NUMBER" },
    }, required: ["description", "category", "amount"] } },
    unknown: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["day", "sales", "expenses", "unknown"],
};

export function aiParsePrompt(text: string, menu: MenuItem[]): { system: string; user: string } {
  const list = menu.filter((m) => m.active).map((m) => `- ${m.name}${m.aliases.length ? ` (เรียกว่า ${m.aliases.join(", ")})` : ""} / ${m.unit}`).join("\n");
  return {
    system: [
      "คุณอ่านข้อความจดยอดขายของร้านอาหารไทย แล้วแปลงเป็นข้อมูล",
      "sales.menu ต้องเป็นชื่อเมนูจากรายการที่ให้มาเท่านั้น สะกดตรงตัว ถ้าไม่แน่ใจว่าเป็นเมนูไหน ให้ใส่ข้อความนั้นใน unknown",
      "ตัวเลขทุกตัวต้องเป็นตัวเลขที่อยู่ในข้อความ ห้ามคำนวณ ห้ามเดา ห้ามรวมเอง",
      "cash = เงินสดจากยอดขายที่นับได้ (ไม่รวมเงินทอนตั้งต้น), transfer = เงินโอน/พร้อมเพย์/QR, expenses = รายจ่าย เช่น ค่าไก่ ซื้อผัก ค่าแก๊ส",
      "day = yesterday เฉพาะเมื่อข้อความบอกว่าเป็นของเมื่อวาน",
    ].join("\n"),
    user: `เมนูของร้าน:\n${list}\n\nข้อความ:\n${text}`,
  };
}

/** Keeps only what the message supports; anything else goes to `unknown`. */
export function checkAiParse(raw: unknown, text: string, menu: MenuItem[]): Parsed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const typed = numbersIn(text);
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && typed.has(v);
  const out: Parsed = { day: /เมื่อวาน/.test(normalize(text)) ? "yesterday" : "today", sales: [], cash: null, transfer: null, expenses: [], unknown: [], by: "ai" };
  const byName = new Map(menu.filter((m) => m.active).map((m) => [squash(m.name), m]));
  const sales = new Map<string, ParsedSale>();
  for (const s of Array.isArray(r.sales) ? r.sales as Record<string, unknown>[] : []) {
    const item = typeof s?.menu === "string" ? byName.get(squash(s.menu)) : undefined;
    if (!item || !ok(s.quantity) || s.quantity === 0) { out.unknown.push(`${String(s?.menu ?? "?")} ${String(s?.quantity ?? "")}`.trim()); continue; }
    const prev = sales.get(item.id);
    sales.set(item.id, { menu_item_id: item.id, name: item.name, unit: item.unit, price: Number(item.price), quantity: (prev?.quantity ?? 0) + s.quantity });
  }
  out.sales = [...sales.values()];
  if (ok(r.cash)) out.cash = r.cash;
  if (ok(r.transfer)) out.transfer = r.transfer;
  for (const e of Array.isArray(r.expenses) ? r.expenses as Record<string, unknown>[] : []) {
    if (!ok(e?.amount) || e.amount === 0 || typeof e.description !== "string") { out.unknown.push(`${String(e?.description ?? "?")} ${String(e?.amount ?? "")}`.trim()); continue; }
    const category = typeof e.category === "string" && EXPENSE_CATEGORIES.includes(e.category) ? e.category : "อื่น ๆ";
    out.expenses.push({ category, description: e.description.slice(0, 120), amount: e.amount });
  }
  for (const u of Array.isArray(r.unknown) ? r.unknown : []) if (typeof u === "string" && u.trim()) out.unknown.push(u.trim().slice(0, 60));
  return out;
}
