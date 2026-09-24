// Shop assistant data model (005_shops.sql): menus with cost, daily entries, cash vs transfer,
// expenses, voiding, forecasting - and that one shop can never touch another shop's data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS = ["001_schema.sql", "002_analytics.sql", "003_features.sql", "004_import_batches.sql", "005_shops.sql"];
let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ x: T }>(sql, params)).rows[0].x;

type Totals = {
  revenue: number; units: number; gross_profit: number | null; profit_coverage_pct: number | null;
  menus_without_cost: number; expenses: number; cash: number | null; transfer: number | null;
  money_in: number | null; money_gap: number | null; net_cash: number;
};

async function newShop(name: string) {
  const id = await one<string>("insert into shops (name) values ($1) returning id x", [name]);
  await db.query("select shop_menu_upsert($1, $2::jsonb)", [id, JSON.stringify([
    { name: "ข้าวมันไก่", unit: "จาน", price: 50, unit_cost: 28, aliases: ["มันไก่"] },
    { name: "ต้มยำ", unit: "ถ้วย", price: 60, unit_cost: null },
  ])]);
  const menu = (await db.query<{ id: string; name: string }>("select id, name from menu_items where shop_id = $1", [id])).rows;
  return { id, menu: Object.fromEntries(menu.map((m) => [m.name, m.id])) as Record<string, string> };
}

const record = (shop: string, date: string, entry: object) =>
  one<string>("select shop_record_day($1, $2::date, $3::jsonb) x", [shop, date, JSON.stringify(entry)]);
const totals = (shop: string, date: string) =>
  one<{ today: Totals }>("select shop_day_summary($1, $2::date) x", [shop, date]).then((s) => s.today);

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8"));
});
afterAll(() => db.close());

describe("one day at a stall", () => {
  it("revenue, profit (partial when a cost is missing), cash vs transfer, money gap, net cash", async () => {
    const s = await newShop("ร้านทดสอบ");
    await record(s.id, "2026-09-01", {
      sales: [{ menu_item_id: s.menu["ข้าวมันไก่"], quantity: 40 }, { menu_item_id: s.menu["ต้มยำ"], quantity: 10 }],
      cash: 1000, transfer: 1500,                                   // counted 2,500 vs sales 2,600
      expenses: [{ category: "วัตถุดิบ", description: "ไก่", amount: 800 }],
    });
    const t = await totals(s.id, "2026-09-01");
    expect(t).toMatchObject({
      revenue: 2600, units: 50,
      gross_profit: 880,                  // 40 x (50 - 28); ต้มยำ has no cost yet
      profit_coverage_pct: 76.9,          // 2,000 of 2,600 revenue has a known cost
      menus_without_cost: 1,
      cash: 1000, transfer: 1500, money_in: 2500, money_gap: -100,   // ฿100 missing
      expenses: 800, net_cash: 1800,
    });
  });

  it("a later cost change does not rewrite old profit", async () => {
    const s = await newShop("ร้านต้นทุน");
    await record(s.id, "2026-09-01", { sales: [{ menu_item_id: s.menu["ข้าวมันไก่"], quantity: 10 }] });
    await db.query("update menu_items set unit_cost = 40 where id = $1", [s.menu["ข้าวมันไก่"]]);
    expect((await totals(s.id, "2026-09-01")).gross_profit).toBe(220);   // still 10 x (50 - 28)
  });

  it("voiding an entry removes it from the numbers but keeps it in the history", async () => {
    const s = await newShop("ร้านยกเลิก");
    await record(s.id, "2026-09-02", { sales: [{ menu_item_id: s.menu["ข้าวมันไก่"], quantity: 5 }] });
    const wrong = await record(s.id, "2026-09-02", { sales: [{ menu_item_id: s.menu["ข้าวมันไก่"], quantity: 500 }] });
    expect((await totals(s.id, "2026-09-02")).revenue).toBe(25250);
    expect(await one<boolean>("select shop_void_entry($1, $2) x", [s.id, wrong])).toBe(true);
    expect((await totals(s.id, "2026-09-02")).revenue).toBe(250);
    const day = await one<{ entries: { voided: boolean }[] }>("select shop_day_summary($1, '2026-09-02') x", [s.id]);
    expect(day.entries.map((e) => e.voided)).toEqual([false, true]);
  });

  it("no payments recorded -> cash/transfer/gap are null, not zero", async () => {
    const s = await newShop("ร้านไม่นับเงิน");
    await record(s.id, "2026-09-03", { sales: [{ menu_item_id: s.menu["ข้าวมันไก่"], quantity: 1 }] });
    expect(await totals(s.id, "2026-09-03")).toMatchObject({ cash: null, transfer: null, money_gap: null });
  });
});

describe("shops are isolated", () => {
  it("cannot record another shop's menu item, void its entries, or see its sales", async () => {
    const a = await newShop("ร้าน A");
    const b = await newShop("ร้าน B");
    await expect(record(a.id, "2026-09-01", { sales: [{ menu_item_id: b.menu["ข้าวมันไก่"], quantity: 1 }] }))
      .rejects.toThrow(/ไม่ใช่ของร้านนี้/);
    const bEntry = await record(b.id, "2026-09-01", { sales: [{ menu_item_id: b.menu["ข้าวมันไก่"], quantity: 3 }] });
    expect(await one<boolean>("select shop_void_entry($1, $2) x", [a.id, bEntry])).toBe(false);
    expect((await totals(a.id, "2026-09-01")).revenue).toBe(0);
    expect((await totals(b.id, "2026-09-01")).revenue).toBe(150);
  });
});

describe("demo shop, period summary and forecast", () => {
  let demo: string;
  beforeAll(async () => { demo = await one<string>("select shop_create_demo(56) x"); });

  it("has 8 weeks of entries, closed on Sundays", async () => {
    const days = await one<number>("select count(distinct entry_date)::int x from shop_sales_lines where shop_id = $1", [demo]);
    expect(days).toBe(48);
    expect(await one<number>(
      "select count(*)::int x from shop_sales_lines where shop_id = $1 and extract(isodow from entry_date) = 7", [demo])).toBe(0);
  });

  it("period summary: menus ranked, previous period, weekday pattern shows busy Fridays", async () => {
    const p = await one<{ menus: { name: string; margin_pct: number | null }[]; weekday: { dow: number; avg_revenue: number }[];
      current: Totals; previous: Totals }>("select shop_period_summary($1, current_date - 28, current_date - 1) x", [demo]);
    expect(p.menus[0].name).toBe("ข้าวมันไก่");
    expect(p.menus.find((m) => m.name === "ต้มยำไก่")?.margin_pct).toBeNull();     // cost not set
    const fri = p.weekday.find((w) => w.dow === 5)!.avg_revenue;
    const tue = p.weekday.find((w) => w.dow === 2)!.avg_revenue;
    expect(fri).toBeGreaterThan(tue * 1.2);
    expect(p.previous.revenue).toBeGreaterThan(0);
  });

  it("forecast uses the same weekday of the last 4 weeks and gives a range", async () => {
    // a Friday that has 4 recorded Fridays before it
    const friday = await one<string>(
      "select max(entry_date)::text x from shop_sales_lines where shop_id = $1 and extract(isodow from entry_date) = 5", [demo]);
    const f = await one<{ samples: number; items: { name: string; expected: number; low: number; high: number }[] }>(
      "select shop_forecast($1, $2::date) x", [demo, friday]);
    expect(f.samples).toBe(4);
    const rice = f.items.find((i) => i.name === "ข้าวมันไก่")!;
    expect(rice.low).toBeLessThanOrEqual(rice.expected);
    expect(rice.expected).toBeLessThanOrEqual(rice.high);
    expect(rice.expected).toBeGreaterThan(45);                       // Fridays are busier than the base 42
  });

  it("the demo has one day with money missing, so the gap check has something to find", async () => {
    const gaps = await one<number>(`
      select count(*)::int x from (
        select e.entry_date, sum(p.cash + p.transfer) - sum(s.amount) gap
        from day_entries e join entry_payments p on p.entry_id = e.id
        join (select entry_id, sum(amount) amount from entry_sales group by 1) s on s.entry_id = e.id
        where e.shop_id = $1 group by 1) d where gap < 0`, [demo]);
    expect(gaps).toBe(1);
  });
});
