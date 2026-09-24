// LINE bot: reading messages, the AI guard on reading, webhook signatures, and the AI morning message.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkAiParse, looksLikeQuestion, parseRecord, salesTotal, toEntry } from "@/lib/lineparse";
import { confirmCard, verifySignature } from "@/lib/line";
import { aiMorningMessage } from "@/lib/morning";
import type { DaySummary, Forecast, MenuItem, Shop, ShopTotals } from "@/lib/shop";

const item = (id: string, name: string, price: number, unit: string, aliases: string[] = []): MenuItem =>
  ({ id, name, category: "อาหาร", unit, price, unit_cost: null, aliases, active: true });
const MENU = [
  item("m1", "ข้าวมันไก่", 50, "จาน", ["มันไก่"]),
  item("m2", "ข้าวมันไก่พิเศษ", 60, "จาน", ["พิเศษ"]),
  item("m3", "ชาเย็น", 25, "แก้ว"),
  item("m4", "ข้าวไก่ทอด", 55, "จาน", ["ไก่ทอด"]),
];

describe("parseRecord: plain rules, no AI", () => {
  it("reads menus by name or alias, cash, transfer and expenses", () => {
    const p = parseRecord("มันไก่ 40 ชาเย็น 20 ไก่ทอด 12 ค่าไก่ 800 สด 2,500 โอน 1500", MENU);
    expect(p.sales.map((s) => [s.name, s.quantity])).toEqual([["ข้าวมันไก่", 40], ["ชาเย็น", 20], ["ข้าวไก่ทอด", 12]]);
    expect(p.cash).toBe(2500);
    expect(p.transfer).toBe(1500);
    expect(p.expenses).toEqual([{ category: "วัตถุดิบ", description: "ค่าไก่", amount: 800 }]);
    expect(p.unknown).toEqual([]);
    expect(salesTotal(p)).toBe(40 * 50 + 20 * 25 + 12 * 55);
  });

  it("prefers the longer menu name, reads units, Thai digits and 'เมื่อวาน'", () => {
    const p = parseRecord("เมื่อวาน ข้าวมันไก่พิเศษ ๕ จาน, ชาเย็น x3", MENU);
    expect(p.day).toBe("yesterday");
    expect(p.sales.map((s) => [s.name, s.quantity])).toEqual([["ข้าวมันไก่พิเศษ", 5], ["ชาเย็น", 3]]);
  });

  it("an expense word wins over a menu that merely contains it; unknown words are reported", () => {
    const p = parseRecord("ค่าแก๊ส 350 ผัดไทย 4", MENU);
    expect(p.expenses).toEqual([{ category: "แก๊สและน้ำแข็ง", description: "ค่าแก๊ส", amount: 350 }]);
    expect(p.sales).toEqual([]);
    expect(p.unknown).toEqual(["ผัดไทย 4"]);
  });

  it("adds up the same menu written twice and builds the entry for shop_record_day", () => {
    const p = parseRecord("มันไก่ 10 ข้าวมันไก่ 5", MENU);
    expect(toEntry(p)).toEqual({ sales: [{ menu_item_id: "m1", quantity: 15 }], expenses: [], note: "จดผ่าน LINE" });
  });

  it("tells questions from numbers to record", () => {
    expect(looksLikeQuestion("เมื่อวานกำไรเท่าไหร่")).toBe(true);
    expect(looksLikeQuestion("4 สัปดาห์ล่าสุดเมนูไหนขายดี")).toBe(true);
    expect(looksLikeQuestion("มันไก่ 40 ชาเย็น 20")).toBe(false);
  });
});

describe("checkAiParse: the AI may only use what the owner typed", () => {
  const msg = "มันไก่สี่สิบ... ไม่ใช่ มันไก่ 40 ส้มตำ 3 จ่ายค่าน้ำแข็ง 60";
  it("keeps grounded items and drops invented numbers or menus", () => {
    const p = checkAiParse({
      day: "today",
      sales: [{ menu: "ข้าวมันไก่", quantity: 40 }, { menu: "ส้มตำ", quantity: 3 }, { menu: "ชาเย็น", quantity: 7 }],
      cash: 2000,                                                                       // never typed
      expenses: [{ description: "ค่าน้ำแข็ง", category: "แก๊สและน้ำแข็ง", amount: 60 }],
      unknown: [],
    }, msg, MENU)!;
    expect(p.by).toBe("ai");
    expect(p.sales.map((s) => [s.name, s.quantity])).toEqual([["ข้าวมันไก่", 40]]);
    expect(p.cash).toBeNull();
    expect(p.expenses).toHaveLength(1);
    expect(p.unknown).toEqual(["ส้มตำ 3", "ชาเย็น 7"]);
  });
  it("rejects garbage", () => {
    expect(checkAiParse("nope", msg, MENU)).toBeNull();
  });
});

describe("LINE webhook signature", () => {
  it("accepts only the body signed with the channel secret", () => {
    const body = JSON.stringify({ events: [] });
    const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifySignature(body, sig, "s3cret")).toBe(true);
    expect(verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
  });
});

describe("confirm card", () => {
  it("shows the money gap and carries the draft id on both buttons", () => {
    const p = parseRecord("มันไก่ 10 สด 400", MENU);
    const card = JSON.stringify(confirmCard(p, "d-1", "2026-09-25", "฿"));
    expect(card).toContain("เงินขาด");
    expect(card).toContain("confirm:d-1");
    expect(card).toContain("cancel:d-1");
  });
});

// ---------------------------------------------------------------- AI morning message

const totals = (revenue: number): ShopTotals => ({
  revenue, units: 10, days_recorded: 1, gross_profit: revenue * 0.4, profit_coverage_pct: 100, menus_without_cost: 0,
  expenses: 500, cash: null, transfer: null, money_in: null, money_gap: null, net_cash: revenue - 500,
});
const SHOP: Shop = { id: "s1", name: "ร้านป้าแดง", currency: "THB", is_demo: false };
const Y: DaySummary = {
  date: "2026-09-24", today: totals(3000), same_day_last_week: totals(2500), last_7_days_avg_revenue: 2800,
  menus: [{ menu_item_id: "m1", name: "ข้าวมันไก่", category: "อาหาร", unit: "จาน", quantity: 40, revenue: 2000, share: 66, gross_profit: 800, margin_pct: 40, prev_quantity: 35, quantity_change_pct: 14 }],
  entries: [],
};
const FC: Forecast = { date: "2026-09-25", samples: 4, items: [{ menu_item_id: "m1", name: "ข้าวมันไก่", unit: "จาน", samples: 4, expected: 42, low: 38, high: 46 }] };
const reply = (t: string) => async () => ({ content: { role: "model" as const, parts: [{ text: t }] }, model: "fake", usage: { input: 10, output: 5 } });

describe("aiMorningMessage", () => {
  it("fills the AI's placeholders with real numbers", async () => {
    const r = await aiMorningMessage(SHOP, "฿", Y, FC, {
      model: reply("☀️ เมื่อวานขายได้ {y_day.revenue} {y_day.dir} {y_day.pct} กำไรราว {y_day.profit}\nวันนี้เตรียม {f_f1.name} ประมาณ {f_f1.expected} นะ"),
    });
    expect(r.source).toBe("ai");
    expect(r.message.body).toContain("฿ 3,000");
    expect(r.message.body).toContain("เพิ่มขึ้น 20.0%");
    expect(r.message.body).toContain("42 จาน");
  });

  it("falls back to the rule-based message when the AI keeps writing its own numbers", async () => {
    const r = await aiMorningMessage(SHOP, "฿", Y, FC, { model: reply("เมื่อวานขายได้ 3,100 บาท เพิ่มขึ้นเยอะเลย") });
    expect(r.source).toBe("template");
    expect(r.issues?.join(" ")).toMatch(/numbers|direction/);
    expect(r.message.body).toContain("ยอดขาย ฿ 3,000");
  });

  it("falls back when Gemini is down", async () => {
    const r = await aiMorningMessage(SHOP, "฿", Y, FC, { model: async () => { throw new Error("503"); } });
    expect(r.source).toBe("template");
  });
});
