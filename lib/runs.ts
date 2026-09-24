// Run log: one row per automation / AI run (006_automation_runs.sql).
//   const run = startRun("assistant", "manual", { title: question });
//   const data = await run.step("tool shop_period", () => rpc(...), (r) => `${r.menus.length} เมนู`);
//   await run.finish("success", { output: {...} });
// Logging never breaks the feature it is logging: write errors are swallowed.
import { insert, supabaseConfigured } from "./supabase";
import type { Usage } from "./gemini";

export type RunStatus = "success" | "fallback" | "failed";
export type RunStep = { name: string; status: "ok" | "error"; ms: number; detail?: string };

export type Run = {
  id: string | null;
  step<T>(name: string, fn: () => Promise<T>, describe?: (r: T) => string): Promise<T>;
  note(name: string, detail: string): void;
  ai(model: string, usage: Usage): void;
  /** Which shop the run belongs to, when that is only known part-way (LINE messages). */
  setShop(id: string): void;
  finish(status: RunStatus, extra?: { error?: string; output?: unknown }): Promise<void>;
  steps: RunStep[];
};

export function startRun(kind: string, trigger: string, opts: { title?: string; shopId?: string | null } = {}): Run {
  const started = new Date();
  const t0 = performance.now();
  const steps: RunStep[] = [];
  let model: string | null = null;
  const tokens = { input: 0, output: 0 };
  let shopId = opts.shopId ?? null;

  return {
    id: null,
    steps,
    async step(name, fn, describe) {
      const s = performance.now();
      try {
        const r = await fn();
        steps.push({ name, status: "ok", ms: Math.round(performance.now() - s), detail: describe?.(r) });
        return r;
      } catch (e) {
        steps.push({ name, status: "error", ms: Math.round(performance.now() - s), detail: (e as Error).message.slice(0, 300) });
        throw e;
      }
    },
    note(name, detail) {
      steps.push({ name, status: "ok", ms: 0, detail: detail.slice(0, 500) });
    },
    setShop(id) {
      shopId = id;
    },
    ai(m, usage) {
      model = m;
      tokens.input += usage.input;
      tokens.output += usage.output;
    },
    async finish(status, extra = {}) {
      if (!supabaseConfigured()) return;
      try {
        await insert("automation_runs", [{
          kind, trigger, status, shop_id: shopId, title: opts.title?.slice(0, 200) ?? null,
          started_at: started.toISOString(), duration_ms: Math.round(performance.now() - t0),
          model, input_tokens: tokens.input, output_tokens: tokens.output,
          steps, error: extra.error?.slice(0, 1000) ?? null, output: extra.output ?? null,
        }]);
      } catch {
        // table missing (migration 006 not run) or Supabase down: the feature itself still worked
      }
    },
  };
}
