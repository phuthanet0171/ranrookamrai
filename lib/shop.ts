// Shop assistant: types for 005_shops.sql and small server-side helpers.
import { rpc, select } from "./supabase";

export type Shop = { id: string; name: string; currency: string; is_demo: boolean };

export type MenuItem = {
  id: string; name: string; category: string; unit: string; price: number;
  unit_cost: number | null; aliases: string[]; active: boolean;
};

export type ShopTotals = {
  revenue: number; units: number; days_recorded: number;
  gross_profit: number | null; profit_coverage_pct: number | null; menus_without_cost: number;
  expenses: number; cash: number | null; transfer: number | null; money_in: number | null;
  money_gap: number | null; net_cash: number;
};

export type MenuRow = {
  menu_item_id: string; name: string; category: string; unit: string; quantity: number; revenue: number;
  share: number | null; gross_profit: number | null; margin_pct: number | null;
  prev_quantity: number; quantity_change_pct: number | null;
};

export type DaySummary = {
  date: string; today: ShopTotals; same_day_last_week: ShopTotals; last_7_days_avg_revenue: number | null;
  menus: MenuRow[];
  entries: { id: string; source: string; author: string | null; created_at: string; voided: boolean }[];
};

export type Forecast = {
  date: string; samples: number;
  items: { menu_item_id: string; name: string; unit: string; samples: number; expected: number; low: number; high: number }[];
};

export type PeriodSummary = {
  range: { start: string; end: string; days: number; prev_start: string; prev_end: string };
  current: ShopTotals; previous: ShopTotals; menus: MenuRow[];
  daily: { date: string; revenue: number }[];
  weekday: { dow: number; avg_revenue: number; days: number }[];
  expenses_by_category: { category: string; amount: number }[];
};

export const listShops = () => select<Shop>("shops", "select=id,name,currency,is_demo&order=created_at");
export const getMenu = (shop: string) =>
  select<MenuItem>("menu_items", `shop_id=eq.${encodeURIComponent(shop)}&select=id,name,category,unit,price,unit_cost,aliases,active&order=category,name`);
export const daySummary = (shop: string, date: string) => rpc<DaySummary>("shop_day_summary", { p_shop: shop, p_date: date });
export const forecast = (shop: string, date: string) => rpc<Forecast>("shop_forecast", { p_shop: shop, p_date: date });
export const periodSummary = (shop: string, start: string, end: string) =>
  rpc<PeriodSummary>("shop_period_summary", { p_shop: shop, p_start: start, p_end: end });

/** Today's date in Thailand (the server may run in UTC). */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------------------------------------------------------------- input checks (server)

const num = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Returns an error message (Thai) or null. */
export function checkEntry(e: unknown): string | null {
  if (!e || typeof e !== "object") return "ข้อมูลไม่ถูกต้อง";
  const o = e as Record<string, unknown>;
  const sales = o.sales ?? [];
  if (!Array.isArray(sales) || sales.length > 200) return "รายการขายไม่ถูกต้อง";
  for (const s of sales as Record<string, unknown>[]) {
    if (!isUuid(s?.menu_item_id)) return "รหัสเมนูไม่ถูกต้อง";
    if (!num(s.quantity, 100_000)) return "จำนวนต้องเป็นตัวเลข 0 ขึ้นไป";
    if (s.amount !== undefined && s.amount !== null && !num(s.amount, 1e8)) return "ยอดเงินไม่ถูกต้อง";
  }
  for (const k of ["cash", "transfer"] as const) {
    if (o[k] !== undefined && o[k] !== null && !num(o[k], 1e8)) return "ยอดเงินสด/เงินโอนไม่ถูกต้อง";
  }
  const exp = o.expenses ?? [];
  if (!Array.isArray(exp) || exp.length > 50) return "รายจ่ายไม่ถูกต้อง";
  for (const x of exp as Record<string, unknown>[]) {
    if (!num(x?.amount, 1e8) || !((x.amount as number) > 0)) return "รายจ่ายต้องมากกว่า 0";
    if (x.category !== undefined && !text(x.category, 40)) return "หมวดรายจ่ายไม่ถูกต้อง";
    if (x.description !== undefined && x.description !== null && typeof x.description !== "string") return "รายละเอียดรายจ่ายไม่ถูกต้อง";
  }
  const hasSomething = (sales as unknown[]).length > 0 || exp.length > 0 || o.cash != null || o.transfer != null;
  return hasSomething ? null : "ยังไม่ได้กรอกอะไรเลย";
}

export function checkMenu(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return "รายการเมนูไม่ถูกต้อง";
  for (const m of items as Record<string, unknown>[]) {
    if (!text(m?.name, 80)) return "ชื่อเมนูต้องมี 1–80 ตัวอักษร";
    if (!num(m.price, 1e6)) return `ราคาของ “${m.name}” ไม่ถูกต้อง`;
    if (m.unit_cost !== null && m.unit_cost !== undefined && !num(m.unit_cost, 1e6)) return `ต้นทุนของ “${m.name}” ไม่ถูกต้อง`;
    if (m.aliases !== undefined && (!Array.isArray(m.aliases) || m.aliases.some((a) => !text(a, 40)))) return "ชื่อเรียกอื่นไม่ถูกต้อง";
    if (m.id !== undefined && m.id !== null && !isUuid(m.id)) return "รหัสเมนูไม่ถูกต้อง";
  }
  return null;
}
