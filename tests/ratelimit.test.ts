import { beforeEach, describe, expect, it } from "vitest";
import { blocked, clientIp, hit, resetLimits } from "@/lib/ratelimit";

const LIMIT = { max: 3, windowMs: 60_000 };

describe("rate limiter", () => {
  beforeEach(resetLimits);

  it("allows up to max calls per window, then asks to wait", () => {
    const t = 1_000_000;
    expect([hit("a", LIMIT, t), hit("a", LIMIT, t + 1), hit("a", LIMIT, t + 2)]).toEqual([0, 0, 0]);
    expect(hit("a", LIMIT, t + 3)).toBe(60);
    expect(hit("b", LIMIT, t + 3)).toBe(0);                    // other visitors unaffected
    expect(hit("a", LIMIT, t + 60_001)).toBe(0);               // window slid past the first call
  });

  it("blocked() checks without counting", () => {
    const t = 5_000_000;
    for (let i = 0; i < 3; i++) hit("pw", LIMIT, t);
    expect(blocked("pw", LIMIT, t + 10)).toBeGreaterThan(0);
    expect(blocked("other", LIMIT, t + 10)).toBe(0);
    expect(blocked("other", LIMIT, t + 10)).toBe(0);           // still 0: nothing was counted
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
