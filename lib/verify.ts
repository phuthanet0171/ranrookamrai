// Secondary check, used by the tests on the rule-based summaries: every number in a text must
// appear in the facts. The AI itself is held to a stricter rule - see lib/factset.ts (placeholders only).
//
// We pull all numbers out of the "facts" we gave the model, then pull all numbers
// out of what the model wrote. Any number in the text that is not in the facts
// (allowing for normal rounding, e.g. 6.0% -> 6%) is reported as unverified.

type Token = { value: number; raw: string; abbreviated: boolean; percent: boolean };

const NUM_RE = /(\d[\d,]*(?:\.\d+)?)(\s?(?:k|K|M)\b)?(\s?%)?/g;

export function extractNumbers(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    let value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] ?? "").trim();
    if (suffix === "k" || suffix === "K") value *= 1_000;
    if (suffix === "M") value *= 1_000_000;
    out.push({ value, raw: m[0].trim(), abbreviated: Boolean(suffix), percent: Boolean(m[3]) });
  }
  return out;
}

export function allowedNumbers(facts: string[]): number[] {
  return [...new Set(extractNumbers(facts.join("\n")).map((t) => t.value))];
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function isAllowed(t: Token, allowed: number[]): boolean {
  // tiny counts like "top 3" or "7-day" are fine, but not "5%"
  if (!t.abbreviated && !t.percent && Number.isInteger(t.value) && t.value <= 10) return true;
  return allowed.some((a) => {
    if (t.abbreviated) return a >= 1000 && Math.abs(t.value - a) / a <= 0.006;
    return t.value === a || t.value === round(a, 0) || t.value === round(a, 1);
  });
}

export function verifyText(text: string, facts: string[]): { verified: boolean; unverified: string[] } {
  const allowed = allowedNumbers(facts);
  const unverified = extractNumbers(text).filter((t) => !isAllowed(t, allowed)).map((t) => t.raw);
  return { verified: unverified.length === 0, unverified: [...new Set(unverified)] };
}
