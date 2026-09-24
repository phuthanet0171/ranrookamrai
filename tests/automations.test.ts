// Automation rules (007_automations.sql + lib/automations.ts): Bangkok-time scheduling,
// no double sends when two cron callers overlap, and the messages built from shop data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localNow, missingEntryMessage, moneyGapMessage, morningMessage, weeklyMessage } from "@/lib/automations";
import type { DaySummary, Forecast, PeriodSummary, Shop } from "@/lib/shop";

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS = ["001_schema.sql", "002_analytics.sql", "003_features.sql", "004_import_batches.sql",
  "005_shops.sql", "006_automation_runs.sql", "007_automations.sql"];
let db: PGlite;
let shopId: string;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ x: T }>(sql, params)).rows[0].x;
const due = async (utc: string) =>
  (await db.query<{ kind: string }>("select kind from automation_due($1::timestamptz) order by kind", [utc])).rows.map((r) => r.kind);

beforeAll(async () => {
  db = new PGlite();
  for (const f of MIGRATIONS) await db.exec(readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8"));
  shopId = await one<string>("insert into shops (name) values ('ร้านทดสอบ') returning id x");
  await db.query(`insert into automation_rules (shop_id, kind, run_at, days) values
    ($1, 'morning_summary', '08:00', '{1,2,3,4,5,6}'),
    ($1, 'missing_entry',   '21:00', '{1,2,3,4,5,6}'),
    ($1, 'weekly_summary',  '08:30', '{1}')`, [shopId]);
});
afterAll(() => db.close());

describe("automation_due uses Thai time", () => {
  // 2026-09-28 is a Monday. 01:00 UTC = 08:00 in Bangkok.
  it("nothing is due before 08:00 Bangkok", async () => {
    expect(await due("2026-09-28T00:59:00Z")).toEqual([]);
  });
  it("08:00 Bangkok on a Monday: the morning summary", async () => {
    expect(await due("2026-09-28T01:05:00Z")).toEqual(["morning_summary"]);
  });
  it("08:30 Bangkok on Monday: morning + weekly (the weekly rule only runs on Mondays)", async () => {
    expect(await due("2026-09-28T01:35:00Z")).toEqual(["morning_summary", "weekly_summary"]);
    expect(await due("2026-09-29T01:35:00Z")).toEqual(["morning_summary"]);          // Tuesday
  });
  it("respects the weekdays: Sunday is off for these rules", async () => {
    expect(await due("2026-09-27T15:00:00Z")).toEqual([]);                            // Sunday 22:00 Bangkok
  });
  it("disabled rules never run", async () => {
    await db.query("update automation_rules set enabled = false where kind = 'missing_entry'");
    expect(await due("2026-09-28T14:30:00Z")).not.toContain("missing_entry");         // Monday 21:30
    await db.query("update automation_rules set enabled = true where kind = 'missing_entry'");
    expect(await due("2026-09-28T14:30:00Z")).toContain("missing_entry");
  });
});

describe("automation_claim prevents double sends", () => {
  it("only the first caller of the day wins, the next day is free again", async () => {
    const rule = await one<string>("select id x from automation_rules where kind = 'morning_summary'");
    const [a, b] = await Promise.all([
      one<boolean>("select automation_claim($1, '2026-09-28') x", [rule]),
      one<boolean>("select automation_claim($1, '2026-09-28') x", [rule]),
    ]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(await due("2026-09-28T02:00:00Z")).not.toContain("morning_summary");       // fired today
    expect(await one<boolean>("select automation_claim($1, '2026-09-29') x", [rule])).toBe(true);
  });

  it("rejects a Discord rule without a real webhook URL (no requests to arbitrary hosts)", async () => {
    await expect(db.query(`insert into automation_rules (shop_id, kind, run_at, channel, target)
      values ($1, 'money_gap', '22:00', 'discord', 'http://169.254.169.254/latest')`, [shopId])).rejects.toThrow();
  });
});

describe("localNow", () => {
  it("converts to Bangkok time across midnight", () => {
    expect(localNow(new Date("2026-09-27T18:30:00Z"))).toEqual({ date: "2026-09-28", time: "01:30" });
  });
});

// ---------------------------------------------------------------- messages
const shop: Shop = { id: "s1", name: "ร้านป้าแดง", currency: "THB", is_demo: false };
const totals = (over: Partial<DaySummary["today"]> = {}): DaySummary["today"] => ({
  revenue: 3000, units: 60, days_recorded: 1, gross_profit: 1200, profit_coverage_pct: 100, menus_without_cost: 0,
  expenses: 900, cash: 1000, transfer: 1800, money_in: 2800, money_gap: -200, net_cash: 2100, ...over,
});
const day = (over: Partial<DaySummary> = {}): DaySummary => ({
  date: "2026-09-27", today: totals(), same_day_last_week: totals({ revenue: 2500 }), last_7_days_avg_revenue: 2800,
  menus: [{ menu_item_id: "m1", name: "ข้าวมันไก่", category: "อาหาร", unit: "จาน", quantity: 40, revenue: 2000, share: 66.7,
    gross_profit: 880, margin_pct: 44, prev_quantity: 35, quantity_change_pct: 14.3 }],
  entries: [{ id: "e1", source: "web", author: null, created_at: "2026-09-27T13:00:00Z", voided: false }], ...over,
});

describe("messages", () => {
  it("missing entry: only when nothing (non-voided) was recorded today", () => {
    expect(missingEntryMessage(shop, day())).toBeNull();
    const voidedOnly = day({ entries: [{ id: "e1", source: "web", author: null, created_at: "", voided: true }] });
    expect(missingEntryMessage(shop, voidedOnly, "https://x.app")?.body).toContain("https://x.app/shop?shop=s1");
  });

  it("morning summary: sales vs last week, profit, money gap, best sellers, what to prepare", () => {
    const fc: Forecast = { date: "2026-09-28", samples: 4, items: [{ menu_item_id: "m1", name: "ข้าวมันไก่", unit: "จาน", samples: 4, expected: 45, low: 40, high: 52 }] };
    const m = morningMessage(shop, "฿", day(), fc);
    expect(m.body).toContain("ยอดขาย ฿ 3,000 (▲ 20.0% เทียบกับสัปดาห์ก่อน)");
    expect(m.body).toContain("⚠️ เงินขาด ฿ 200");
    expect(m.body).toContain("• ข้าวมันไก่ ~45 จาน (ปกติ 40–52)");
  });

  it("money gap: respects the threshold, silent when money was not counted", () => {
    expect(moneyGapMessage(shop, "฿", day(), 100)?.title).toBe("⚠️ เงินขาด ฿ 200 · ร้านป้าแดง");
    expect(moneyGapMessage(shop, "฿", day(), 500)).toBeNull();
    expect(moneyGapMessage(shop, "฿", day({ today: totals({ money_gap: null, money_in: null }) }), 0)).toBeNull();
  });

  it("weekly summary picks the most profitable menu and the best weekday", () => {
    const p = {
      range: { start: "2026-09-21", end: "2026-09-27", days: 7, prev_start: "2026-09-14", prev_end: "2026-09-20" },
      current: totals({ revenue: 20000, gross_profit: 8000, days_recorded: 6, money_gap: 0 }),
      previous: totals({ revenue: 25000 }),
      menus: [
        { ...day().menus[0], name: "ชาเย็น", gross_profit: 900, quantity: 90 },
        { ...day().menus[0], name: "ข้าวมันไก่", gross_profit: 5000, quantity: 250 },
      ],
      daily: [], expenses_by_category: [],
      weekday: [{ dow: 2, avg_revenue: 2500, days: 1 }, { dow: 5, avg_revenue: 4200, days: 1 }],
    } as PeriodSummary;
    const m = weeklyMessage(shop, "฿", p);
    expect(m.body).toContain("ยอดขาย ฿ 20,000 (▼ 20.0% เทียบกับสัปดาห์ก่อน)");
    expect(m.body).toContain("เมนูทำกำไรสูงสุด: ข้าวมันไก่");
    expect(m.body).toContain("วันที่ขายดีที่สุด: วันศุกร์");
  });
});
