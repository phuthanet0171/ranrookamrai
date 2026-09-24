import { describe, expect, it } from "vitest";
import { addDays, dateLong, dateWithDay, money, money2, moneyCompact, pct, pts, setCurrency } from "@/lib/format";
import { categoryLabel, regionLabel, segmentLabel } from "@/lib/labels";

describe("Thai dates use พ.ศ.", () => {
  it("formats dates", () => {
    expect(dateLong("2018-05-14")).toBe("14 พ.ค. 2561");
    expect(dateLong("2018-05-14", "en")).toBe("14 May 2018");
    expect(dateWithDay("2018-05-14")).toBe("วันจันทร์ที่ 14 พ.ค. 2561");
  });
  it("does date math without time-zone drift", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
});

describe("money follows the dataset currency", () => {
  it("switches symbol", () => {
    setCurrency("THB");
    expect(money(1234.6)).toBe("฿ 1,235");
    expect(money2(-5)).toBe("-฿ 5.00");
    setCurrency("BRL");
    expect(money(1009935.1)).toBe("R$ 1,009,935");
    expect(moneyCompact(40000)).toBe("R$40k");
  });
  it("formats changes", () => {
    expect(pct(4.4)).toBe("+4.4%");
    expect(pct(null, "–")).toBe("–");
    expect(pts(0.7, "th")).toBe("+0.7 จุด");
  });
});

describe("labels", () => {
  it("translates Olist keys and keeps imported Thai names", () => {
    expect(categoryLabel("health_beauty")).toBe("สุขภาพและความงาม");
    expect(categoryLabel("health_beauty", "en")).toBe("Health beauty");
    expect(categoryLabel("เครื่องดื่ม")).toBe("เครื่องดื่ม");
    expect(regionLabel("SP")).toBe("เซาเปาลู (SP)");
    expect(regionLabel("สาขาสยาม")).toBe("สาขาสยาม");
    expect(segmentLabel("time_of_day", "Evening (18-23)")).toBe("ช่วงค่ำ (18–23 น.)");
  });
});
