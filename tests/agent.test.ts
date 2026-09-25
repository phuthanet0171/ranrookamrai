// The assistant loop with a scripted model: tool calls, placeholder answers, rule breaking,
// unknown tools and bad arguments. No network: the model and the tools are fakes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { runAgent, SHOP_TOOLS, type AgentScope, type ModelFn, type Tool } from "@/lib/agent";
import type { Content } from "@/lib/gemini";

const scope: AgentScope = { kind: "shop", shopId: "00000000-0000-0000-0000-000000000001", name: "ร้านทดสอบ", sym: "฿", today: "2026-09-25" };
const proseScope: AgentScope = { kind: "dataset", bounds: { min_date: "2026-01-01", max_date: "2026-09-25", sim_date: null },
  ctx: {}, today: "2026-09-25", name: "ชุดทดสอบ" };

const fakeTool: Tool = {
  name: "shop_day",
  description: "test",
  params: { date: "YYYY-MM-DD" },
  async run(args, env) {
    if (args.date > "2026-09-25") throw new Error("date เป็นวันในอนาคต");
    return { lang: "th", facts: [{ id: `${env.prefix}_day`, about: "วันนั้น", values: { revenue: "฿ 2,600", dir: "เพิ่มขึ้น", pct: "8.3%", gap: "เงินขาด ฿ 100" } }] };
  },
};

/** A model that replies from a script, one reply per call; records what it was sent. */
function scripted(replies: Content["parts"][]): ModelFn & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const fn = (async (body: Record<string, unknown>) => {
    calls.push(body);
    const parts = replies[calls.length - 1] ?? [{ text: "" }];
    return { content: { role: "model", parts }, model: "fake-model", usage: { input: 10, output: 5 } };
  }) as ModelFn & { calls: Record<string, unknown>[] };
  fn.calls = calls;
  return fn;
}

describe("runAgent", () => {
  it("calls a tool, then answers with placeholders that the code fills in", async () => {
    const model = scripted([
      [{ functionCall: { name: "shop_day", args: { date: "2026-09-24" } } }],
      [{ text: "เมื่อวานยอดขาย {t1_day.revenue} {t1_day.dir} {t1_day.pct}\n• {t1_day.gap}" }],
    ]);
    const a = await runAgent("เมื่อวานเป็นยังไง", proseScope, { model, tools: [fakeTool] });
    expect(a.source).toBe("ai");
    expect(a.answer).toBe("เมื่อวานยอดขาย ฿ 2,600 เพิ่มขึ้น 8.3%\n• เงินขาด ฿ 100");
    expect(a.tools).toMatchObject([{ name: "shop_day", ok: true, facts: 1 }]);
    // the tool result went back to the model as placeholders with their values
    const second = JSON.stringify(model.calls[1]);
    expect(second).toContain("{t1_day.revenue} = ฿ 2,600");
  });

  it("an answer with numbers the AI wrote itself is rewritten; if it still breaks the rules the facts are shown instead", async () => {
    const model = scripted([
      [{ functionCall: { name: "shop_day", args: { date: "2026-09-24" } } }],
      [{ text: "เมื่อวานขายได้ ฿ 9,999 เพิ่มขึ้น" }],          // invents a number + a direction word
      [{ text: "ขายได้ 9,999 บาท" }],                          // still breaks the rules
    ]);
    const a = await runAgent("เมื่อวานเป็นยังไง", proseScope, { model, tools: [fakeTool] });
    expect(a.source).toBe("facts");
    expect(a.answer).not.toContain("9,999");
    expect(a.answer).toContain("฿ 2,600");
    expect(model.calls).toHaveLength(3);
  });

  it("a rewrite that follows the rules is accepted", async () => {
    const model = scripted([
      [{ functionCall: { name: "shop_day", args: { date: "2026-09-24" } } }],
      [{ text: "ขายได้ 2,600 บาท" }],
      [{ text: "ขายได้ {t1_day.revenue}" }],
    ]);
    const a = await runAgent("ขายได้เท่าไหร่", proseScope, { model, tools: [fakeTool] });
    expect(a).toMatchObject({ source: "ai", answer: "ขายได้ ฿ 2,600" });
  });

  it("unknown tools and bad arguments are reported to the model as errors, not crashes", async () => {
    const model = scripted([
      [{ functionCall: { name: "drop_tables", args: {} } }, { functionCall: { name: "shop_day", args: { date: "2030-01-01" } } }],
      [{ text: "ตอบไม่ได้ ลองถามเรื่องยอดขายของวันที่ผ่านมาแล้ว" }],
    ]);
    const a = await runAgent("ปี 2030 ขายได้เท่าไหร่", proseScope, { model, tools: [fakeTool] });
    expect(a.tools.map((t) => [t.name, t.ok])).toEqual([["drop_tables", false], ["shop_day", false]]);
    expect(a.tools[1].error).toMatch(/อนาคต/);
    expect(JSON.stringify(model.calls[1])).toContain("ไม่มีเครื่องมือชื่อ drop_tables");
  });

  it("stops asking for tools after the last round", async () => {
    const loop = [{ functionCall: { name: "shop_day", args: { date: "2026-09-24" } } }];
    const model = scripted([loop, loop, loop, [{ text: "ยอดขาย {t1_day.revenue}" }]]);
    const a = await runAgent("วนไปเรื่อย ๆ", proseScope, { model, tools: [fakeTool] });
    expect(model.calls).toHaveLength(4);
    const last = model.calls[3] as { toolConfig: { functionCallingConfig: { mode: string } } };
    expect(last.toolConfig.functionCallingConfig.mode).toBe("NONE");
    expect(a.source).toBe("ai");
  });
});

describe("automation_runs (006)", () => {
  it("stores runs and summarises them", async () => {
    const db = new PGlite();
    for (const f of ["001_schema.sql", "002_analytics.sql", "003_features.sql", "004_import_batches.sql", "005_shops.sql", "006_automation_runs.sql"]) {
      await db.exec(readFileSync(path.join(__dirname, "..", "..", "supabase", "migrations", f), "utf8"));
    }
    await db.exec(`insert into automation_runs (kind, trigger, status, started_at, duration_ms, input_tokens, output_tokens, steps) values
      ('assistant','manual','success', now(), 1200, 100, 20, '[{"name":"AI round 1","status":"ok","ms":900}]'),
      ('insight','manual','fallback', now(), 800, 50, 10, '[]'),
      ('daily_report','schedule','failed', now() - interval '30 days', 100, 0, 0, '[]')`);
    const s = (await db.query<{ x: Record<string, number> }>("select automation_stats(7) x")).rows[0].x;
    expect(s).toMatchObject({ runs: 2, success: 1, fallback: 1, failed: 0, avg_ms: 1000, input_tokens: 150, output_tokens: 30 });
    await expect(db.exec("insert into automation_runs (kind, trigger, status, started_at, duration_ms) values ('x','y','maybe', now(), 1)"))
      .rejects.toThrow();
    await db.close();
  });
});

describe("off-topic questions", () => {
  it("round 1 must pick a tool; cannot_answer ends with a fixed reply and no data", async () => {
    const model = scripted([[{ functionCall: { name: "cannot_answer", args: { reason: "ขอให้แต่งกลอน" } } }]]);
    const a = await runAgent("ช่วยแต่งกลอนให้หน่อย", scope, { model, tools: [fakeTool] });
    expect(a).toMatchObject({ source: "none", note: "ขอให้แต่งกลอน" });
    expect(a.answer).toMatch(/ถามได้เฉพาะเรื่องยอดขาย/);
    const first = model.calls[0] as { toolConfig: { functionCallingConfig: { mode: string } } };
    expect(first.toolConfig.functionCallingConfig.mode).toBe("ANY");
  });
});

describe("renderDraft grammar", () => {
  it("'{x.dir} {x.cmp}' written together keeps only the comparison", async () => {
    const { renderDraft } = await import("@/lib/factset");
    const set = { lang: "th" as const, facts: [{ id: "r", about: "", values: { dir: "เพิ่มขึ้น", cmp: "สูงกว่า", avg: "฿ 10" } }] };
    expect(renderDraft("รายได้{r.dir} {r.cmp}ค่าเฉลี่ย {r.avg}", set)).toBe("รายได้สูงกว่าค่าเฉลี่ย ฿ 10");
  });

  it("drops a period word the value already carries", async () => {
    const { renderDraft } = await import("@/lib/factset");
    const set = { lang: "th" as const, facts: [{ id: "p", about: "", values: { span: "4 สัปดาห์" } }] };
    expect(renderDraft("จากข้อมูล {p.span} สัปดาห์ล่าสุด", set)).toBe("จากข้อมูล 4 สัปดาห์ล่าสุด");
  });
});

describe("MVP grounding", () => {
  it("rejects prose when the provider skips tools, even without digits", async () => {
    const model = scripted([[{ text: "ร้านมีกำไรแน่นอน" }], [{ text: "ร้านมีกำไรแน่นอน" }]]);
    expect((await runAgent("กำไรเป็นอย่างไร", scope, { model, tools: [fakeTool] })).source).toBe("none");
  });
  it("falls back to facts when prose does not cite tool output", async () => {
    const model = scripted([
      [{ functionCall: { name: "shop_day", args: { date: "2026-09-24" } } }],
      [{ text: "ร้านมีกำไรแน่นอน" }], [{ text: "ร้านมีกำไรแน่นอน" }],
    ]);
    const result = await runAgent("กำไรเป็นอย่างไร", scope, { model, tools: [fakeTool] });
    expect(result.source).toBe("facts");
    expect(result.answer).toContain("ยอดขาย ฿ 2,600");
    expect(result.answer).not.toContain("ร้านมีกำไรแน่นอน");
    expect(model.calls).toHaveLength(1);
  });
  it("rejects invalid forecast dates before querying SQL", async () => {
    const tool = SHOP_TOOLS.find((t) => t.name === "shop_forecast")!;
    for (const date of ["2026-02-30", "2026-09-24", "2026-10-10"]) {
      await expect(tool.run({ date }, { scope, prefix: "t1" })).rejects.toThrow();
    }
  });
});
