// The AI layer. Flow:
//   SQL results -> named facts (lib/factset.ts) -> Gemini writes the briefing with
//   placeholders only -> checkDraft() rejects any number / direction word / unknown
//   placeholder the AI wrote itself -> the code fills the placeholders with the real
//   values -> if the draft fails twice, the rule-based summary is used instead.
// Verified AI results are cached in Supabase.
import { createHash } from "node:crypto";
import type { DailyReport, DashboardData, Insight, Lang } from "./types";
import { dailyTemplate, rangeTemplate, type FactContext } from "./facts";
import { checkDraft, dailyFactSet, factsForPrompt, rangeFactSet, renderDraft, type FactSet } from "./factset";
import { generateSummary, type AiSummary } from "./gemini";
import { cacheGet, cachePut } from "./supabase";
import type { Run } from "./runs";

const PROMPT_VERSION = "v3.2-placeholders";

function systemPrompt(lang: Lang): string {
  const th = lang === "th";
  return [
    "You are a sales analyst writing a short briefing for a busy shop owner.",
    "You are given FACTS. Each fact has placeholders like {revenue.now} and the value the system will put there.",
    "HARD RULES - a draft that breaks any of them is thrown away:",
    "1. Never write a digit (0-9 or Thai digits) yourself. Every number, amount, percentage, date and count",
    "   must be a placeholder copied exactly, e.g. {revenue.now}, {revenue.pct}, {d1.amount}.",
    "2. Never write a direction or comparison word yourself (" +
      (th ? "เพิ่มขึ้น, ลดลง, สูงกว่า, ต่ำกว่า, ทรงตัว, เติบโต, ร่วง, พุ่ง, มากขึ้น, น้อยลง ..." : "rose, fell, grew, dropped, up, down, higher, lower, above, below, more, less ...") +
      "). Use the {x.dir} placeholder (" + (th ? "เพิ่มขึ้น / ลดลง / ทรงตัว" : "rose / fell / was flat") +
      ") or {x.cmp} (" + (th ? "สูงกว่า / ต่ำกว่า / ใกล้เคียงกับ" : "above / below / in line with") + ").",
    "3. Use only placeholders that exist in FACTS, and only with the fact they belong to",
    "   (say {orders.now} when talking about orders, never another fact's value). Values already include their",
    "   unit or currency (\"80 คน\", \"฿ 1,200\"), so do not write the unit again after a placeholder.",
    "   Use {x.dir} OR {x.cmp} in a sentence, never both. Only {x.amount} is a difference; now/previous_period/baseline are totals.",
    "4. Facts say WHICH segments changed, not WHY. Do not invent causes. You may suggest what to check.",
    "5. 'share' values add up to 100% only within one dimension; never add or compare shares across dimensions.",
    "6. headline: one sentence with the main result. bullets: 3 to 5 short bullets, most important first.",
    "   recommendation: one concrete next step.",
    th
      ? "7. เขียนภาษาไทยที่เป็นธรรมชาติ สุภาพ แบบรายงานผู้บริหาร ไม่แปลตรงตัว ไม่ใส่จุด (.) ท้ายประโยค " +
        "ใช้ชื่อหมวด สาขา และช่วงเวลาผ่าน placeholder {x.name} เท่านั้น"
      : "7. Write plain, natural English.",
    th
      ? "Example: \"รายได้{revenue.dir} {revenue.pct} เป็น {revenue.now} เมื่อเทียบกับ{period.compare}\""
      : "Example: \"Revenue {revenue.dir} {revenue.pct} to {revenue.now} compared with {period.compare}.\"",
  ].join("\n");
}

const allText = (s: { headline: string; bullets: string[]; recommendation: string }) =>
  [s.headline, ...s.bullets, s.recommendation].join("\n");

function render(s: AiSummary, set: FactSet) {
  return {
    headline: renderDraft(s.headline, set),
    bullets: s.bullets.map((b) => renderDraft(b, set)),
    recommendation: renderDraft(s.recommendation, set),
  };
}

async function explain(
  cacheKey: string,
  set: FactSet,
  template: { headline: string; bullets: string[]; recommendation: string },
  lang: Lang,
  opts: Opts = {},
): Promise<Insight> {
  const th = lang === "th";
  const run = opts.run;
  const fallback = (note: string, rejected: string[] = []): Insight => ({
    ...template, source: "template", verified: true, unverified_numbers: rejected, note,
  });

  if (!process.env.GEMINI_API_KEY) {
    return fallback(th
      ? "ยังไม่ได้ตั้งค่า GEMINI_API_KEY จึงแสดงสรุปจากระบบแทน (ไม่ได้ใช้ AI)"
      : "GEMINI_API_KEY is not set, so this is the rule-based summary (no AI).");
  }

  const factsBlock = factsForPrompt(set);
  const key = `${cacheKey}:${lang}:${PROMPT_VERSION}`;
  const factsHash = createHash("sha256").update(factsBlock).digest("hex").slice(0, 32);
  if (opts.useCache !== false) {
    const hit = await cacheGet(key);
    if (hit && hit.facts_hash === factsHash) {
      run?.note("cache", "ใช้สรุปที่ผ่านการตรวจแล้วจากตาราง ai_insights");
      return { ...(hit.response as Insight), cached: true };
    }
  }

  let prompt = `FACTS:\n${factsBlock}\n\nWrite the briefing as JSON, using placeholders only.`;
  let lastIssues: string[] = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const draft = run
        ? await run.step(`AI draft #${attempt}`, () => generateSummary(systemPrompt(lang), prompt), (d) => `${d.model} · ${d.usage.input}+${d.usage.output} tokens`)
        : await generateSummary(systemPrompt(lang), prompt);
      run?.ai(draft.model, draft.usage);
      const check = checkDraft(allText(draft), set);
      run?.note(`check draft #${attempt}`, check.ok ? "ผ่าน: ใช้แต่ช่องว่าง" : `ไม่ผ่าน: ${check.issues.join("; ")}`);
      if (check.ok) {
        const insight: Insight = {
          ...render(draft, set), source: "ai", verified: true, unverified_numbers: [], model: draft.model,
          note: attempt > 1
            ? th ? "ร่างแรกของ AI ผิดกติกา ระบบจึงให้เขียนใหม่" : "The AI's first draft broke the rules and was rewritten."
            : undefined,
        };
        await cachePut(key, factsHash, insight);
        return insight;
      }
      lastIssues = check.issues;
      prompt = `FACTS:\n${factsBlock}\n\nYour previous draft was rejected: ${check.issues.join("; ")}.\n` +
        "Rewrite it following every HARD RULE. Use placeholders only. Write the briefing as JSON.";
    }
  } catch (err) {
    return fallback(th
      ? `เรียกใช้ AI ไม่สำเร็จ (${(err as Error).message}) จึงแสดงสรุปจากระบบแทน`
      : `AI unavailable (${(err as Error).message}). Showing the rule-based summary.`);
  }
  return fallback(
    th
      ? `ร่างของ AI ผิดกติกา 2 ครั้ง (${lastIssues.join("; ")}) ระบบจึงแสดงสรุปจากระบบแทน`
      : `The AI's drafts broke the rules twice (${lastIssues.join("; ")}). Showing the rule-based summary.`,
    lastIssues,
  );
}

type Opts = { useCache?: boolean; run?: Run };

export function explainRange(d: DashboardData, lang: Lang, ctx: FactContext = {}, opts?: Opts) {
  return explain(`range:${d.range.start}:${d.range.end}`, rangeFactSet(d, lang, ctx), rangeTemplate(d, lang, ctx), lang, opts);
}

export function explainDaily(r: DailyReport, lang: Lang, ctx: FactContext = {}, opts?: Opts) {
  return explain(`daily:${r.date}`, dailyFactSet(r, lang, ctx), dailyTemplate(r, lang, ctx), lang, opts);
}
