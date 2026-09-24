// Round 2 of the code review: the old check only asked "does this number appear somewhere
// in the facts?", so swapping revenue with orders or writing "ลดลง" for a rise still passed.
// Now the AI may only write placeholders; these tests are the attacks from the review.
import { describe, expect, it } from "vitest";
import type { DashboardData } from "@/lib/types";
import { checkDraft, factsForPrompt, rangeFactSet, renderDraft } from "@/lib/factset";
import { setCurrency } from "@/lib/format";

setCurrency("THB");

const d = {
  range: { start: "2024-05-01", end: "2024-05-30", days: 30, prev_start: "2024-04-01", prev_end: "2024-04-30" },
  kpis: {
    current: { revenue: 110000, orders: 1000, items: 1500, customers: 800, aov: 110, on_time_rate: null },
    previous: { revenue: 100000, orders: 1100, items: 1600, customers: 850, aov: 90.91, on_time_rate: null },
    growth_pct: { revenue: 10, orders: -9.1, aov: 21, customers: -5.9 },
    on_time_change_pts: null,
  },
  trend: [],
  by_category: [{ key: "กาแฟ", label: "กาแฟ", revenue: 60000, orders: 600, share: 54.5 }],
  by_state: [], by_hour: [], by_weekday: [],
  drivers: {
    current_period: { start: "2024-05-01", end: "2024-05-30" },
    baseline_period: { start: "2024-04-01", end: "2024-04-30", note: "" },
    total_current: 110000, total_baseline: 100000, total_change: 10000, total_change_pct: 10,
    segments: [{ dimension: "state", segment: "สาขาอารีย์", direction: "down", current: 20000, baseline: 30000,
      change: -10000, change_pct: -33.3, share_of_total_change: null }],
  },
} as unknown as DashboardData;

const th = rangeFactSet(d, "th", { currency: "THB", region: "สาขา" });

describe("fact set", () => {
  it("direction words come from the data, not the AI", () => {
    const values = (id: string) => th.facts.find((f) => f.id === id)!.values;
    expect(values("revenue")).toMatchObject({ dir: "เพิ่มขึ้น", cmp: "สูงกว่า", pct: "10.0%", now: "฿ 110,000" });
    expect(values("orders")).toMatchObject({ dir: "ลดลง", pct: "9.1%", now: "1,000 คำสั่งซื้อ" });
    expect(values("d1")).toMatchObject({ name: "สาขา “สาขาอารีย์”", dir: "ลดลง", amount: "฿ 10,000" });
  });

  it("counts carry their unit and money carries the currency, so a swap is visible", () => {
    // the worst the AI can do now is put a value under the wrong word - and the unit gives it away
    expect(renderDraft("รายได้ {orders.now}", th)).toBe("รายได้ 1,000 คำสั่งซื้อ");
  });

  it("the prompt lists every placeholder with its value", () => {
    expect(factsForPrompt(th)).toContain("{revenue.dir} = เพิ่มขึ้น");
  });
});

describe("checkDraft rejects what the review found", () => {
  it("accepts a draft that only uses placeholders, and renders it", () => {
    const draft = "รายได้{revenue.dir} {revenue.pct} เป็น {revenue.now} เมื่อเทียบกับ{period.compare}";
    expect(checkDraft(draft, th)).toEqual({ ok: true, issues: [] });
    expect(renderDraft(draft, th)).toBe("รายได้เพิ่มขึ้น 10.0% เป็น ฿ 110,000 เมื่อเทียบกับช่วง 30 วันก่อนหน้า");
  });

  it("rejects 'ลดลง' written by the AI when revenue actually rose", () => {
    const r = checkDraft("รายได้ลดลง {revenue.pct}", th);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/ลดลง/);
  });

  it("rejects swapping numbers: revenue written as a literal (even a real one)", () => {
    expect(checkDraft("รายได้ ฿ 1,000 และคำสั่งซื้อ 110,000", th).ok).toBe(false);
  });

  it("rejects any digit, including Thai digits and small counts", () => {
    expect(checkDraft("สินค้า ๓ อันดับแรก", th).ok).toBe(false);
    expect(checkDraft("ดู 3 อันดับแรก", th).ok).toBe(false);
  });

  it("rejects placeholders that do not exist (e.g. customers the data cannot count)", () => {
    const noCustomers = rangeFactSet({ ...d, kpis: { ...d.kpis, current: { ...d.kpis.current, customers: null } } } as DashboardData, "th");
    expect(checkDraft("ลูกค้า {customers.now}", noCustomers).issues).toEqual(["unknown placeholder {customers.now}"]);
    expect(checkDraft("{revenue.nope}", th).ok).toBe(false);
  });

  it("rejects English direction words too", () => {
    const en = rangeFactSet(d, "en");
    expect(checkDraft("Revenue {revenue.dir} {revenue.pct}.", en).ok).toBe(true);
    expect(checkDraft("Revenue went down {revenue.pct}.", en).ok).toBe(false);
    expect(checkDraft("Orders were higher than last month.", en).ok).toBe(false);
  });
});

describe("renderDraft keeps Thai readable", () => {
  it("adds the space Thai puts around numbers and quoted names", () => {
    expect(renderDraft("หมวดสินค้า{cat1.name}ทำรายได้{cat1.revenue}", th)).toBe("หมวดสินค้า “กาแฟ” ทำรายได้ ฿ 60,000");
    expect(renderDraft("รายได้{revenue.dir} {revenue.pct}เมื่อเทียบ", th)).toBe("รายได้เพิ่มขึ้น 10.0% เมื่อเทียบ");
  });
  it("drops a unit the AI repeated after a value that already has it", () => {
    expect(renderDraft("ลูกค้า {customers.now} คน", th)).toBe("ลูกค้า 800 คน");
  });
});

describe("renderDraft drops a repeated dimension name", () => {
  it("'สาขา {d1.name}' does not become 'สาขา สาขา “…”'", () => {
    expect(renderDraft("ตรวจสอบสาขา {d1.name}", th)).toBe("ตรวจสอบสาขา “สาขาอารีย์”");
  });
});

describe("renderDraft tidies common AI slips in Thai", () => {
  const set = { lang: "th" as const, facts: [{ id: "x", about: "", values: {
    orders: "14 คำสั่งซื้อ", compare: "ค่าเฉลี่ยรายวันของ 7 วันก่อน", date: "วันจันทร์ที่ 30 พ.ค. 2548", dir: "เพิ่มขึ้น", cmp: "สูงกว่า" } }] };
  it.each([
    ["มี {x.orders} บิล", "มี 14 คำสั่งซื้อ"],
    ["สูงกว่าค่าเฉลี่ยรายวันของ {x.compare}", "สูงกว่าค่าเฉลี่ยรายวันของ 7 วันก่อน"],
    ["ยอดขายวันที่ {x.date}", "ยอดขายวันจันทร์ที่ 30 พ.ค. 2548"],
    ["รายได้ {x.dir}", "รายได้เพิ่มขึ้น"],
  ])("%s", (draft, want) => {
    expect(renderDraft(draft, set)).toBe(want);
  });
});
