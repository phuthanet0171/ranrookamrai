// Preview of the daily email, so you can test without n8n.
// /report?date=2018-05-24&lang=th        summary from the rules (free, instant)
// /report?date=2018-05-24&lang=th&ai=1   AI summary (uses Gemini, cached per day)
import type { Metadata } from "next";
import type { DailyReport, Insight, Lang } from "@/lib/types";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { addDays, dateLong, dateWithDay, isIsoDate } from "@/lib/format";
import { anchorDate, factContext, hasData, loadBounds } from "@/lib/data";
import { dailyTemplate } from "@/lib/facts";
import { explainDaily } from "@/lib/insights";
import { buildChatText, buildEmail } from "@/lib/report";
import { EmptyNotice, ErrorNotice, SetupNotice } from "@/components/Notice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "รายงานประจำวัน" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "th";
  const useAi = sp.ai === "1";

  const bounds = await loadBounds().catch((e: Error) => e);
  if (bounds instanceof Error) return <ErrorNotice message={bounds.message} />;
  if (!hasData(bounds)) return <EmptyNotice />;

  let report: DailyReport, insight: Insight;
  const ctx = factContext(bounds);
  try {
    const fallback = anchorDate(bounds);
    let date = isIsoDate(sp.date) ? sp.date : fallback;
    if (date < bounds.min_date || date > bounds.max_date) date = fallback;
    report = await rpc<DailyReport>("daily_report", { p_date: date });
    insight = useAi
      ? await explainDaily(report, lang, ctx)
      : { ...dailyTemplate(report, lang, ctx), source: "template", verified: true, unverified_numbers: [],
          note: lang === "th" ? "หน้าตัวอย่างนี้ใช้สรุปจากระบบ กด “เวอร์ชัน AI” เพื่อให้ Gemini เขียนสรุป" : "Preview uses the rule-based summary. Click 'AI version' to call Gemini." };
  } catch (e) {
    return <ErrorNotice message={(e as Error).message} />;
  }

  const email = buildEmail(report, insight, process.env.APP_URL, lang, ctx.region);
  const chat = buildChatText(report, insight, lang, process.env.APP_URL);
  const link = (p: Record<string, string>) => {
    const q = new URLSearchParams({ date: report.date, lang, ...(useAi ? { ai: "1" } : {}), ...p });
    return `/report?${q.toString()}`;
  };
  const prev = addDays(report.date, -1), next = addDays(report.date, 1);

  return (
    <>
      <div className="page-head">
        <div>
                    <h1>ตัวอย่างรายงานประจำวัน</h1>
          <p>{dateWithDay(report.date)} <span className="muted">· หัวข้ออีเมล: {email.subject}</span></p>
        </div>
        <div className="controls">
          <div className="seg" aria-label="เลือกวัน">
            {prev >= bounds.min_date && <a href={link({ date: prev })}>← {dateLong(prev)}</a>}
            {next <= bounds.max_date && <a href={link({ date: next })}>{dateLong(next)} →</a>}
          </div>
          <div className="seg" aria-label="ภาษา">
            <a href={link({ lang: "th" })} aria-current={lang === "th" ? "true" : undefined}>ไทย</a>
            <a href={link({ lang: "en" })} aria-current={lang === "en" ? "true" : undefined}>English</a>
          </div>
          {useAi
            ? <a className="btn" href={`/report?date=${report.date}&lang=${lang}`}>เวอร์ชันสรุปจากระบบ</a>
            : <a className="btn btn-primary" href={`/report?date=${report.date}&lang=${lang}&ai=1`}>✨ เวอร์ชัน AI</a>}
        </div>
      </div>

      {report.anomaly && (
        <div className={`alert ${report.anomaly === "drop" ? "alert-err" : "alert-ok"}`}>
          <span aria-hidden="true">{report.anomaly === "drop" ? "⚠️" : "📈"}</span>
          <div>
            <strong>{report.anomaly === "drop" ? "วันนี้ยอดขายลดลงผิดปกติ" : "วันนี้ยอดขายสูงผิดปกติ"}</strong>
            <p>
              รายได้ต่างจากค่าเฉลี่ย 7 วันเกิน 25%
              {report.anomaly === "drop" ? " n8n จะส่งอีเมลนี้ไปยังผู้รับการแจ้งเตือนด้วย" : ""}
            </p>
          </div>
        </div>
      )}

      <div className="grid report-grid">
        <iframe className="email-frame" title="ตัวอย่างอีเมล" srcDoc={email.html} />
        <section className="card">
          <div className="card-head">
            <div>
              <h2>ข้อความสำหรับแชต</h2>
              <span className="sub">n8n ส่งข้อความนี้เข้า Discord / Telegram</span>
            </div>
          </div>
          <pre className="code" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, margin: 0 }}>{chat}</pre>
        </section>
      </div>
    </>
  );
}
