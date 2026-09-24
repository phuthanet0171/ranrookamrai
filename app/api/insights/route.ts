// POST /api/insights  { start: "2018-05-01", end: "2018-05-31", lang: "th" | "en" }
// Called by the "สร้างสรุปด้วย AI" button on the dashboard.
import type { DashboardData, Lang } from "@/lib/types";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { daysBetween, isIsoDate } from "@/lib/format";
import { factContext, loadBounds } from "@/lib/data";
import { explainRange } from "@/lib/insights";
import { clientIp, hit, tooMany } from "@/lib/ratelimit";
import { startRun } from "@/lib/runs";

// per visitor, plus a global cap so the Gemini free tier is never exhausted by one site
const PER_IP = { max: 10, windowMs: 10 * 60_000 };
const GLOBAL = { max: 120, windowMs: 60 * 60_000 };

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds - Gemini can be slow on the free tier

export async function POST(req: Request) {
  const wait = hit(`insights:${clientIp(req)}`, PER_IP) || hit("insights:all", GLOBAL);
  if (wait) return tooMany(wait, "ขอสรุปด้วย AI ");
  if (!supabaseConfigured()) return Response.json({ error: "ยังไม่ได้ตั้งค่า Supabase" }, { status: 500 });

  let body: { start?: unknown; end?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "ข้อมูลที่ส่งมาต้องเป็น JSON" }, { status: 400 });
  }
  const { start, end } = body;
  const lang: Lang = body.lang === "en" ? "en" : "th";
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    return Response.json({ error: "start และ end ต้องเป็นวันที่ (YYYY-MM-DD) และ start ต้องไม่หลัง end" }, { status: 400 });
  }
  if (daysBetween(start, end) > 800) {
    return Response.json({ error: "ช่วงวันที่ยาวเกินไป" }, { status: 400 });
  }

  const run = startRun("insight", "manual", { title: `สรุป ${start} ถึง ${end} (${lang})` });
  try {
    const bounds = await loadBounds();
    const data = await run.step("SQL dashboard_data", () => rpc<DashboardData>("dashboard_data", { p_start: start, p_end: end }),
      (d) => `${d.drivers.segments.length} ส่วนที่เปลี่ยน`);
    const insight = await explainRange(data, lang, factContext(bounds), { run });
    await run.finish(insight.source === "ai" ? "success" : "fallback", { output: { headline: insight.headline, note: insight.note } });
    return Response.json(insight);
  } catch (e) {
    await run.finish("failed", { error: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
