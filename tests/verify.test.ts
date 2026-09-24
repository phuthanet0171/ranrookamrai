// The guardrail that keeps the AI honest: every number it writes must come from the facts.
import { describe, expect, it } from "vitest";
import { extractNumbers, verifyText } from "@/lib/verify";

const facts = [
  "รายได้: R$ 1,009,935 เทียบกับ R$ 967,348 (+4.4%)",
  "จำนวนคำสั่งซื้อ: 5,743 เทียบกับ 5,468 (+5.0%)",
  "ยอดเฉลี่ยต่อคำสั่งซื้อ: R$ 175.85",
  "ช่วงที่วิเคราะห์: 15 เม.ย. 2561 ถึง 14 พ.ค. 2561 (30 วัน)",
];

describe("extractNumbers", () => {
  it("reads thousands separators, decimals, percents and k/M", () => {
    const t = extractNumbers("R$ 1,009,935 (+4.4%) และ 1.2M กับ 940k");
    expect(t.map((x) => x.value)).toEqual([1009935, 4.4, 1_200_000, 940_000]);
    expect(t[1].percent).toBe(true);
    expect(t[2].abbreviated).toBe(true);
  });
});

describe("verifyText", () => {
  it("accepts text whose numbers all come from the facts", () => {
    const text = "รายได้เพิ่มขึ้น 4.4% เป็น R$ 1,009,935 จากคำสั่งซื้อ 5,743 รายการ ช่วง 15 เม.ย. 2561 – 14 พ.ค. 2561";
    expect(verifyText(text, facts)).toEqual({ verified: true, unverified: [] });
  });

  it("allows normal rounding (5.0% -> 5%) and small counts like 'top 3'", () => {
    expect(verifyText("คำสั่งซื้อเพิ่มขึ้น 5% ดู 3 อันดับแรก", facts).verified).toBe(true);
  });

  it("rejects a number the AI made up", () => {
    const r = verifyText("รายได้เพิ่มขึ้น 12.5% เป็น R$ 1,009,935", facts);
    expect(r.verified).toBe(false);
    expect(r.unverified).toContain("12.5%");
  });

  it("rejects a total the AI calculated itself", () => {
    // 5,743 + 5,468 = 11,211 is not in the facts
    expect(verifyText("รวมสองช่วง 11,211 คำสั่งซื้อ", facts).verified).toBe(false);
  });

  it("rejects small percentages even though small counts are allowed", () => {
    expect(verifyText("โตขึ้น 5%", ["ยอดขาย 100"]).verified).toBe(false);
  });

  it("accepts abbreviations only when they are close to a real value", () => {
    expect(verifyText("ประมาณ 1.01M", facts).verified).toBe(true);
    expect(verifyText("ประมาณ 1.5M", facts).verified).toBe(false);
  });
});
