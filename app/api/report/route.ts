// POST /api/report   (called by n8n every morning)
// Header: x-report-secret: <REPORT_SECRET>
// Body (all optional): { "advance": true, "date": "2018-05-24", "lang": "th" }
//   advance: move the simulated "today" forward one day first, then report on it
//            (only for historic demo data - for imported/live data the last day in the data is used)
//   date:    report on a specific date instead
// Returns: { date, anomaly, subject, html, text, chat_text, sheet_row, insight }
import { timingSafeEqual } from "node:crypto";
import type { DailyReport, Lang } from "@/lib/types";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { isIsoDate } from "@/lib/format";
import { anchorDate, factContext, hasData, loadBounds } from "@/lib/data";
import { explainDaily } from "@/lib/insights";
import { buildChatText, buildEmail, buildSheetRow } from "@/lib/report";
import { startRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds - Gemini can be slow on the free tier

function authorized(req: Request): boolean {
  const secret = process.env.REPORT_SECRET;
  const given = req.headers.get("x-report-secret") ?? "";
  if (!secret) return false;
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.REPORT_SECRET) {
    return Response.json({ error: "Set REPORT_SECRET in the environment first" }, { status: 500 });
  }
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { advance?: unknown; date?: unknown; lang?: unknown };
  const envLang = process.env.REPORT_LANGUAGE === "en" ? "en" : "th";
  const lang: Lang = body.lang === "en" || body.lang === "th" ? body.lang : envLang;

  const run = startRun("daily_report", req.headers.get("x-trigger") ?? "schedule", { title: "รายงานประจำวัน" });
  try {
    const bounds = await loadBounds();
    if (!hasData(bounds)) return Response.json({ error: "The database has no sales data" }, { status: 500 });
    // Olist (historic, BRL) replays one day per run; imported shop data reports on its latest day.
    const replay = (bounds.currency ?? "BRL") === "BRL";
    let date: string;
    if (isIsoDate(body.date)) {
      date = body.date;
    } else if (body.advance === true && replay) {
      date = await rpc<string>("advance_sim_date");
    } else {
      date = anchorDate(bounds);
    }
    const ctx = factContext(bounds);
    const report = await run.step(`SQL daily_report ${date}`, () => rpc<DailyReport>("daily_report", { p_date: date }),
      (x) => `anomaly: ${x.anomaly ?? "none"}`);
    const insight = await explainDaily(report, lang, ctx, { run });
    const appUrl = process.env.APP_URL;
    const email = buildEmail(report, insight, appUrl, lang, ctx.region);
    await run.finish(insight.source === "ai" ? "success" : "fallback",
      { output: { date: report.date, anomaly: report.anomaly, subject: email.subject } });
    return Response.json({
      date: report.date,
      anomaly: report.anomaly,
      revenue: report.today.revenue,
      revenue_vs_7d_avg_pct: report.change_pct.revenue_vs_7d_avg,
      ...email,
      chat_text: buildChatText(report, insight, lang, appUrl),
      sheet_row: buildSheetRow(report, insight),
      insight,
    });
  } catch (e) {
    await run.finish("failed", { error: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
