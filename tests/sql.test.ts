// Runs the real migrations on an in-process PostgreSQL (PGlite), imports data through the
// same begin -> stage -> commit flow the web app uses, and checks the analysis functions.
// The "review" tests reproduce bugs found in code review so they cannot come back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DailyReport, DashboardData, Kpis } from "@/lib/types";
import { guessMapping, toLineItems, type Cell, type LineItem } from "@/lib/importer";
import { dailyFacts, dailyTemplate, rangeFacts, rangeTemplate } from "@/lib/facts";
import { verifyText } from "@/lib/verify";
import { setCurrency } from "@/lib/format";

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS = ["001_schema.sql", "002_analytics.sql", "003_features.sql", "004_import_batches.sql", "005_shops.sql", "006_automation_runs.sql", "007_automations.sql", "008_production.sql", "009_line.sql", "010_line_corrections.sql", "011_automation_retry.sql"];
const allText = (s: { headline: string; bullets: string[]; recommendation: string }) =>
  [s.headline, ...s.bullets, s.recommendation].join("\n");

async function freshDb() {
  const db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8"));
  return db;
}
const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query<{ x: T }>(sql, params)).rows[0].x;

/** Same steps as ImportClient -> /api/import. `stageOnly` stops before commit. */
async function importItems(db: PGlite, items: LineItem[], mode: "replace" | "append",
  opts: { hasOrderIds?: boolean; hasCustomerIds?: boolean; expected?: number; stageOnly?: boolean } = {}) {
  const batch = await one<number>(db, "select import_begin($1::jsonb) x", [JSON.stringify({
    mode, expected_rows: opts.expected ?? items.length, currency: "THB", region_label: "สาขา", dataset_name: "test",
    has_order_ids: opts.hasOrderIds ?? true, has_customer_ids: opts.hasCustomerIds ?? true, has_quantity: true,
  })]);
  for (let i = 0; i < items.length; i += 5000) {
    await db.query("select import_stage($1, $2::jsonb)", [batch, JSON.stringify(items.slice(i, i + 5000))]);
  }
  if (opts.stageOnly) return { batch };
  const res = await one<{ inserted_rows: number; skipped_rows: number }>(db, "select import_commit($1) x", [batch]);
  return { batch, ...res };
}

function parse(headers: string[], rows: Cell[][]) {
  return toLineItems(rows, guessMapping(headers));
}

const kpis = (db: PGlite, start: string, end: string) =>
  one<Kpis>(db, "select _period_kpis($1::date, $2::date) x", [start, end]);
const revenue = async (db: PGlite) => Number(await one<string>(db, "select coalesce(sum(price),0)::text x from sales_lines"));

// ---------------------------------------------------------------- the coffee-shop sample
describe("sample data (Thai coffee shop, 3 branches)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDb();
    const csv = readFileSync(path.join(ROOT, "web", "public", "samples", "thai-cafe-sales.csv"), "utf8").replace(/^﻿/, "");
    const rows = Papa.parse<string[]>(csv, { skipEmptyLines: "greedy" }).data;
    const { items, stats } = toLineItems(rows.slice(1), guessMapping(rows[0]));
    await importItems(db, items, "replace", { hasOrderIds: stats.hasOrderIds, hasCustomerIds: stats.hasCustomerIds });
    setCurrency("THB");
  });
  afterAll(() => db.close());

  it("migrations can be re-run on a loaded database", async () => {
    for (const f of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8"));
    await db.query("refresh materialized view sales_lines");
    expect(await one<number>(db, "select count(*)::int x from sales_lines")).toBeGreaterThan(30_000);
  });

  it("data_bounds() reports the dataset and what it can answer", async () => {
    const b = await one<Record<string, unknown>>(db, "select data_bounds() x");
    expect(b).toMatchObject({ currency: "THB", region_label: "สาขา", has_products: true, has_time: true,
      has_order_ids: true, has_customer_ids: true, has_quantity: true });
  });

  it("dashboard_data() totals match a direct SQL sum; items = sum of quantity", async () => {
    const d = await one<DashboardData>(db, "select dashboard_data('2026-08-25','2026-09-23') x");
    const direct = await one<string>(db,
      "select round(sum(price), 2)::text x from sales_lines where sale_date between '2026-08-25' and '2026-09-23'");
    const units = await one<string>(db,
      "select sum(quantity)::text x from sales_lines where sale_date between '2026-08-25' and '2026-09-23'");
    expect(d.kpis.current.revenue).toBeCloseTo(Number(direct), 2);
    expect(d.kpis.current.items).toBeCloseTo(Number(units), 3);
    expect(d.kpis.current.items!).toBeGreaterThan(await one<number>(db,
      "select count(*)::int x from sales_lines where sale_date between '2026-08-25' and '2026-09-23'"));
    expect(d.trend).toHaveLength(30);
    expect(d.by_hour).toHaveLength(24);
    expect(d.rank_product?.top).toHaveLength(5);
    expect(d.by_category.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(100, 0);
  });

  it("driver analysis finds the story hidden in the sample: branch อารีย์ fell", async () => {
    const d = await one<DashboardData>(db, "select dashboard_data('2026-09-03','2026-09-23') x");
    const ari = d.drivers.segments.find((s) => s.dimension === "state" && s.segment === "สาขาอารีย์");
    expect(ari?.change).toBeLessThan(0);
    const all = await one<{ segments: { dimension: string; share_of_total_change: number }[] }>(db,
      "select _drivers('2026-09-03','2026-09-23','2026-08-13','2026-09-02', 100) x");
    const cat = all.segments.filter((s) => s.dimension === "category").reduce((s, x) => s + x.share_of_total_change, 0);
    expect(cat).toBeCloseTo(100, 0);
  });

  it("the rule-based summaries only use numbers from the facts", async () => {
    const d = await one<DashboardData>(db, "select dashboard_data('2026-08-25','2026-09-23') x");
    const r = await one<DailyReport>(db, "select daily_report('2026-09-23') x");
    const ctx = { currency: "THB", region: "สาขา" };
    for (const lang of ["th", "en"] as const) {
      expect(verifyText(allText(rangeTemplate(d, lang, ctx)), rangeFacts(d, lang, ctx)).unverified).toEqual([]);
      expect(verifyText(allText(dailyTemplate(r, lang, ctx)), dailyFacts(r, lang, ctx)).unverified).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- bugs found in code review
describe("review #1: append never overwrites earlier rows", () => {
  const headers = ["วันที่", "สินค้า", "ยอดขาย"];            // no bill numbers

  it("two files without bill numbers add up (600, not 500)", async () => {
    const db = await freshDb();
    await importItems(db, parse(headers, [["2024-05-01", "ลาเต้", 200], ["2024-05-01", "มอคค่า", 300]]).items,
      "replace", { hasOrderIds: false, hasCustomerIds: false });
    const second = await importItems(db, parse(headers, [["2024-05-02", "ลาเต้", 100]]).items,
      "append", { hasOrderIds: false, hasCustomerIds: false });
    expect(second).toMatchObject({ inserted_rows: 1, skipped_rows: 0 });
    expect(await one<number>(db, "select count(*)::int x from order_items")).toBe(3);
    expect(await revenue(db)).toBe(600);
    await db.close();
  });

  it("a bill that already exists is skipped and reported, never changed", async () => {
    const db = await freshDb();
    const h = ["เลขที่บิล", "วันที่", "สินค้า", "ยอดขาย"];
    await importItems(db, parse(h, [["B1", "2024-05-01", "ลาเต้", 200]]).items, "replace");
    const again = await importItems(db, parse(h, [["B1", "2024-05-01", "ลาเต้", 999], ["B2", "2024-05-02", "ลาเต้", 50]]).items, "append");
    expect(again).toMatchObject({ inserted_rows: 1, skipped_rows: 1 });
    expect(await one<string>(db, "select price::text x from order_items where order_id = 'B1'")).toBe("200.00");
    expect(await revenue(db)).toBe(250);
    await db.close();
  });
});

describe("review #2: branch belongs to the sale, not the customer", () => {
  it("a member buying at another branch does not move old sales", async () => {
    const db = await freshDb();
    const h = ["เลขที่บิล", "วันที่", "สาขา", "รหัสลูกค้า", "ยอดขาย"];
    await importItems(db, parse(h, [["B1", "2024-05-01", "สยาม", "M1", 100]]).items, "replace");
    await importItems(db, parse(h, [["B2", "2024-05-02", "อารีย์", "M1", 50]]).items, "append");
    const d = await one<DashboardData>(db, "select dashboard_data('2024-05-01','2024-05-02') x");
    expect(Object.fromEntries(d.by_state.map((r) => [r.key, r.revenue]))).toEqual({ "สยาม": 100, "อารีย์": 50 });
    expect(d.kpis.current.customers).toBe(1);
    await db.close();
  });
});

describe("review #3: KPIs the data cannot answer are null, not guessed", () => {
  it("daily totals per menu: no bills, no customers -> orders/AOV/customers null; items = quantity", async () => {
    const db = await freshDb();
    const { items } = parse(["วันที่", "สาขา", "เมนู", "จำนวน", "ยอดขาย"],
      [["2024-05-01", "สยาม", "ลาเต้", 10, 650], ["2024-05-01", "สยาม", "มอคค่า", 3, 210]]);
    await importItems(db, items, "replace", { hasOrderIds: false, hasCustomerIds: false });
    const k = await kpis(db, "2024-05-01", "2024-05-01");
    expect(k).toMatchObject({ revenue: 860, orders: null, aov: null, customers: null, items: 13 });
    const b = await one<Record<string, unknown>>(db, "select data_bounds() x");
    expect(b).toMatchObject({ has_order_ids: false, has_customer_ids: false });
    // the summaries must not mention orders at all
    const d = await one<DashboardData>(db, "select dashboard_data('2024-05-01','2024-05-01') x");
    const t = allText(rangeTemplate(d, "th", { currency: "THB", region: "สาขา" }));
    expect(t).not.toContain("คำสั่งซื้อ");
    await db.close();
  });
});

describe("review #6: a failed import leaves the old data untouched", () => {
  const h = ["เลขที่บิล", "วันที่", "สินค้า", "ยอดขาย"];

  it("replace with missing chunks refuses to commit; old data still there", async () => {
    const db = await freshDb();
    await importItems(db, parse(h, [["OLD", "2024-05-01", "ลาเต้", 100]]).items, "replace");
    const { items } = parse(h, [["N1", "2024-06-01", "ลาเต้", 1], ["N2", "2024-06-01", "ลาเต้", 2]]);
    const { batch } = await importItems(db, items.slice(0, 1), "replace", { expected: 2, stageOnly: true });
    await expect(db.query("select import_commit($1)", [batch])).rejects.toThrow(/ไม่ครบ/);
    await db.query("select import_abort($1)", [batch]);
    expect(await revenue(db)).toBe(100);
    expect(await one<string>(db, "select status x from import_batches where id = $1", [batch])).toBe("failed");
    expect(await one<number>(db, "select count(*)::int x from import_staging")).toBe(0);
    await db.close();
  });

  it("an error inside commit rolls everything back", async () => {
    const db = await freshDb();
    await importItems(db, parse(h, [["OLD", "2024-05-01", "ลาเต้", 100]]).items, "replace");
    const { batch } = await importItems(db, parse(h, [["N1", "2024-06-01", "ลาเต้", 5]]).items, "replace", { stageOnly: true });
    // break the staged row after staging so the insert into order_items fails half-way through commit
    await db.query("alter table order_items add constraint test_block check (price <> 5)");
    await expect(db.query("select import_commit($1)", [batch])).rejects.toThrow();
    expect(await revenue(db)).toBe(100);
    expect(await one<number>(db, "select count(*)::int x from orders")).toBe(1);
    expect(await one<string>(db, "select status x from import_batches where id = $1", [batch])).toBe("staging");
    await db.close();
  });

  it("retrying the same chunk does not duplicate rows", async () => {
    const db = await freshDb();
    const { items } = parse(h, [["A", "2024-05-01", "ลาเต้", 10], ["B", "2024-05-01", "ลาเต้", 20]]);
    const { batch } = await importItems(db, items, "replace", { stageOnly: true });
    await db.query("select import_stage($1, $2::jsonb)", [batch, JSON.stringify(items)]);   // same chunk again
    await db.query("select import_commit($1)", [batch]);
    expect(await revenue(db)).toBe(30);
    await db.close();
  });
});

describe("going live: clear the imported sample, keep the shops", () => {
  it("clear_imported_data() empties the analysis data but not shops or entries", async () => {
    const db = await freshDb();
    await importItems(db, parse(["วันที่", "สินค้า", "ยอดขาย"], [["2024-05-01", "ลาเต้", 200]]).items,
      "replace", { hasOrderIds: false, hasCustomerIds: false });
    const shop = await one<string>(db, "select shop_create_demo(14) x");
    const entries = await one<number>(db, "select count(*)::int x from day_entries");
    const res = await one<{ orders_removed: number }>(db, "select clear_imported_data() x");
    expect(res.orders_removed).toBe(1);
    expect(await revenue(db)).toBe(0);
    expect(await one<number>(db, "select count(*)::int x from day_entries")).toBe(entries);
    // deleting a shop takes its menu and entries with it
    await db.query("delete from shops where id = $1", [shop]);
    expect(await one<number>(db, "select count(*)::int x from day_entries")).toBe(0);
    expect(await one<number>(db, "select count(*)::int x from menu_items")).toBe(0);
    await db.close();
  });
});

describe("LINE bot: linking and confirming", () => {
  it("a link code works once, only before it expires", async () => {
    const db = await freshDb();
    const shop = await one<string>(db, "select shop_create_demo(7) x");
    const code = await one<string>(db, "select line_link_create($1) x", [shop]);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(await one<string>(db, "select line_link_claim($1, 'U1', 'ป้าแดง') x", [code])).toBe(shop);
    expect(await one<string | null>(db, "select line_link_claim($1, 'U2') x", [code])).toBeNull();      // used up
    const old = await one<string>(db, "select line_link_create($1) x", [shop]);
    await db.query("update line_link_codes set expires_at = now() - interval '1 minute' where code = $1", [old]);
    expect(await one<string | null>(db, "select line_link_claim($1, 'U3') x", [old])).toBeNull();       // expired
    expect(await one<number>(db, "select count(*)::int x from line_links")).toBe(1);
    await db.close();
  });

  it("confirming a draft twice records it once, and only for the LINE user who wrote it", async () => {
    const db = await freshDb();
    const shop = await one<string>(db, "select shop_create_demo(7) x");
    await db.query("insert into line_links (line_user_id, shop_id) values ('U1', $1)", [shop]);
    const menu = await one<string>(db, "select id x from menu_items where shop_id = $1 limit 1", [shop]);
    const draft = await one<string>(db, `insert into entry_drafts (shop_id, author, raw_text, parsed, line_user_id, entry_date)
      values ($1, 'LINE', 'มันไก่ 3', $2::jsonb, 'U1', current_date) returning id x`, [shop, JSON.stringify({ sales: [{ menu_item_id: menu, quantity: 3 }] })]);
    const before = await one<number>(db, "select count(*)::int x from day_entries where source = 'line'");
    expect(await one<number>(db, "select count(*)::int x from day_entries where source = 'line'")).toBe(before);
    expect(await one<string | null>(db, "select line_draft_confirm($1, 'U2') x", [draft])).toBeNull();   // someone else
    expect(await one<string | null>(db, "select line_draft_confirm($1, 'U1') x", [draft])).not.toBeNull();
    expect(await one<string | null>(db, "select line_draft_confirm($1, 'U1') x", [draft])).toBeNull();   // double tap
    expect(await one<number>(db, "select count(*)::int x from day_entries where source = 'line'")).toBe(before + 1);
    for (const status of ["cancelled", "expired"]) {
      const blocked = await one<string>(db, `insert into entry_drafts (shop_id, author, raw_text, parsed, line_user_id, entry_date)
        values ($1, 'LINE', 'test', $2::jsonb, 'U1', current_date) returning id x`, [shop, JSON.stringify({ sales: [{ menu_item_id: menu, quantity: 99 }] })]);
      if (status === "cancelled") await db.query("update entry_drafts set status = 'cancelled' where id = $1", [blocked]);
      else await db.query("update entry_drafts set created_at = now() - interval '2 days' where id = $1", [blocked]);
      expect(await one<string | null>(db, "select line_draft_confirm($1, 'U1') x", [blocked])).toBeNull();
    }
    expect(await one<number>(db, "select count(*)::int x from day_entries where source = 'line'")).toBe(before + 1);
    // LINE is now a channel for automation rules
    await db.query("insert into automation_rules (shop_id, kind, run_at, channel) values ($1, 'morning_summary', '08:00', 'line')", [shop]);
    await db.close();
  });

  it("LINE correction previews, confirms once, and keeps payments, expenses and cost snapshot", async () => {
    const db = await freshDb();
    const shop = await one<string>(db, "insert into shops (name) values ('แก้ยอดผ่าน LINE') returning id x");
    await db.query("insert into line_links (line_user_id, shop_id) values ('U1', $1)", [shop]);
    const menu = await one<string>(db, "insert into menu_items (shop_id, name, price, unit_cost) values ($1, 'ข้าวมันไก่', 50, 28) returning id x", [shop]);
    const original = await one<string>(db, "select shop_record_day($1, current_date, $2::jsonb, 'line', 'U1') x", [shop,
      JSON.stringify({ sales: [{ menu_item_id: menu, quantity: 4 }], cash: 200,
        expenses: [{ category: "วัตถุดิบ", description: "ข้าว", amount: 20 }] })]);
    const preview = await one<{ entry_id: string; quantity: number; remaining: number; amount_before: number; amount_after: number }>(db,
      "select line_correction_preview('U1', current_date, $1, 1) x", [menu]);
    expect(preview).toMatchObject({ entry_id: original, quantity: 4, remaining: 3, amount_before: 200, amount_after: 150 });
    const draft = await one<string>(db, `insert into entry_drafts (shop_id, raw_text, parsed, line_user_id, entry_date)
      values ($1, 'ลบข้าวมันไก่ 1', $2::jsonb, 'U1', current_date) returning id x`, [shop,
      JSON.stringify({ kind: "decrement", entry_id: original, menu_item_id: menu, quantity: 1, expected_quantity: 4 })]);
    expect(await one<string | null>(db, "select line_draft_confirm($1, 'U2') x", [draft])).toBeNull();
    const replacement = await one<string>(db, "select line_draft_confirm($1, 'U1') x", [draft]);
    expect(replacement).not.toBe(original);
    expect(await one<string | null>(db, "select line_draft_confirm($1, 'U1') x", [draft])).toBeNull();
    expect(await one<number>(db, "select quantity::float8 x from entry_sales where entry_id = $1 and menu_item_id = $2", [replacement, menu])).toBe(3);
    expect(await one<number>(db, "select amount::float8 x from entry_sales where entry_id = $1 and menu_item_id = $2", [replacement, menu])).toBe(150);
    expect(await one<number>(db, "select cash::float8 x from entry_payments where entry_id = $1", [replacement])).toBe(200);
    expect(await one<number>(db, "select amount::float8 x from entry_expenses where entry_id = $1", [replacement])).toBe(20);
    expect(await one<boolean>(db, "select voided_at is not null x from day_entries where id = $1", [original])).toBe(true);
    const stale = await one<string>(db, `insert into entry_drafts (shop_id, raw_text, parsed, line_user_id, entry_date)
      values ($1, 'ลบข้าวมันไก่ 1', $2::jsonb, 'U1', current_date) returning id x`, [shop,
      JSON.stringify({ kind: "decrement", entry_id: original, menu_item_id: menu, quantity: 1, expected_quantity: 4 })]);
    await expect(db.query("select line_draft_confirm($1, 'U1')", [stale])).rejects.toThrow(/เปลี่ยนไปแล้ว/);
    await db.close();
  });
});

describe("Supabase compatibility", () => {
  it("no function uses DELETE/UPDATE without WHERE (Supabase REST rejects them via pg_safeupdate)", () => {
    for (const f of MIGRATIONS) {
      const sql = readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8").replace(/--.*$/gm, "");
      for (const stmt of sql.split(";")) {
        const s = stmt.replace(/\s+/g, " ").trim().toLowerCase()
          .replace(/on conflict .*? do update set .*/, "");         // upserts are not plain UPDATEs
        const m = s.match(/\b(delete from|update) [a-z_]+/);
        if (m && !/ where /.test(s.slice(m.index))) throw new Error(`${f}: "${m[0]}" without WHERE`);
      }
    }
  });
});
