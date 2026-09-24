// Google Gemini API (free tier works). Docs: https://ai.google.dev/gemini-api/docs
// "gemini-flash-latest" always points at the current Flash model, so the app keeps
// working when Google retires a version. When the model is busy (503) or rate limited
// (429) we retry once, then fall back to the lighter model.

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";

export type Usage = { input: number; output: number };
export type AiSummary = { headline: string; bullets: string[]; recommendation: string; model: string; usage: Usage };

// Gemini "Content" objects, kept loose on purpose: model turns are sent back exactly as received
// (newer models attach thought signatures that must be returned unchanged).
export type Part = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [k: string]: unknown;
};
export type Content = { role: "user" | "model"; parts: Part[] };

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    bullets: { type: "ARRAY", items: { type: "STRING" } },
    recommendation: { type: "STRING" },
  },
  required: ["headline", "bullets", "recommendation"],
};

class RetryableError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiResponse = {
  candidates?: { content?: Content }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

async function callModel(model: string, key: string, body: Record<string, unknown>): Promise<GeminiResponse> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* not JSON */ }
    if (res.status === 503 || res.status === 500) throw new RetryableError(`Gemini ไม่ว่างชั่วคราว (${res.status})`);
    if (res.status === 429) throw new RetryableError("ใช้โควตาฟรีของ Gemini ครบแล้ว ลองใหม่อีกครั้งในอีก 1 นาที");
    if (res.status === 404) throw new Error(`ไม่พบรุ่น ${model} ให้แก้ GEMINI_MODEL ใน .env.local (เช่น gemini-flash-latest)`);
    if (res.status === 400 || res.status === 403) throw new Error(`Gemini ปฏิเสธคำขอ (${res.status}): ${msg.slice(0, 150)}`);
    throw new Error(`Gemini error ${res.status}: ${msg.slice(0, 150)}`);
  }
  return (await res.json()) as GeminiResponse;
}

/** One generateContent call with retry + fallback model. */
export async function gemini(body: Record<string, unknown>): Promise<{ content: Content; model: string; usage: Usage }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const plan = [GEMINI_MODEL, GEMINI_MODEL, FALLBACK_MODEL].filter((m, i, a) => m && (i < 2 || m !== a[0]));
  let last: Error = new Error("Gemini ไม่ตอบกลับ");
  for (let i = 0; i < plan.length; i++) {
    try {
      const data = await callModel(plan[i], key, body);
      const content = data.candidates?.[0]?.content ?? { role: "model", parts: [] };
      return {
        content: { role: "model", parts: content.parts ?? [] },
        model: plan[i],
        usage: { input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 },
      };
    } catch (e) {
      last = e as Error;
      if (!(e instanceof RetryableError)) throw e;
      if (i < plan.length - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

export const textOf = (c: Content) => c.parts.map((p) => p.text ?? "").join("").trim();

/** Briefing as JSON {headline, bullets, recommendation}. */
export async function generateSummary(system: string, prompt: string): Promise<AiSummary> {
  const { content, model, usage } = await gemini({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });
  let parsed: Partial<AiSummary>;
  try { parsed = JSON.parse(textOf(content)) as Partial<AiSummary>; } catch { throw new Error("Gemini ตอบกลับในรูปแบบที่ไม่ถูกต้อง"); }
  if (typeof parsed.headline !== "string" || !Array.isArray(parsed.bullets) || typeof parsed.recommendation !== "string") {
    throw new Error("Gemini ตอบกลับในรูปแบบที่ไม่ถูกต้อง");
  }
  return { headline: parsed.headline, bullets: parsed.bullets.map(String), recommendation: parsed.recommendation, model, usage };
}
