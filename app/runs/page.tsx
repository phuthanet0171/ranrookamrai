// ประวัติการทำงาน - every AI summary, daily report, import and assistant question.
import type { Metadata } from "next";
import { isOwner } from "@/lib/auth";
import { count } from "@/lib/format";
import { rpc, select, supabaseConfigured } from "@/lib/supabase";
import { SetupNotice } from "@/components/Notice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ประวัติการทำงาน" };

type Step = { name: string; status: "ok" | "error"; ms: number; detail?: string };
type RunRow = {
  id: string; kind: string; trigger: string; status: "success" | "fallback" | "failed"; title: string | null;
  started_at: string; duration_ms: number; model: string | null; input_tokens: number; output_tokens: number;
  steps: Step[]; error: string | null;
};
type Stats = { runs: number; success: number; fallback: number; failed: number; avg_ms: number | null; p95_ms: number | null;
  input_tokens: number; output_tokens: number };

const KIND_TH: Record<string, string> = {
  insight: "สรุปด้วย AI", daily_report: "รายงานประจำวัน", import: "นำเข้าข้อมูล", assistant: "ผู้ช่วย AI",
};
const TRIGGER_TH: Record<string, string> = { manual: "กดเอง", schedule: "ตามเวลา", webhook: "webhook", api: "API" };
const STATUS: Record<RunRow["status"], { label: string; cls: string }> = {
  success: { label: "สำเร็จ", cls: "pill-up" },
  fallback: { label: "ใช้สรุปจากระบบ", cls: "pill-flat" },
  failed: { label: "ล้มเหลว", cls: "pill-down" },
};

const secs = (ms: number | null) => (ms === null ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} วินาที`);
const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RunsPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  if (!(await isOwner())) {
    return <div className="card notice"><h1>ประวัติการทำงาน</h1><p>หน้านี้สำหรับเจ้าของระบบ <a href="/login">เข้าสู่ระบบ</a></p></div>;
  }
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && KIND_TH[sp.kind] ? sp.kind : null;
  const status = typeof sp.status === "string" && sp.status in STATUS ? sp.status : null;
  const filter = [kind && `kind=eq.${kind}`, status && `status=eq.${status}`].filter(Boolean).join("&");

  let runs: RunRow[], stats: Stats;
  try {
    [runs, stats] = await Promise.all([
      select<RunRow>("automation_runs", `select=*&order=started_at.desc&limit=100${filter ? `&${filter}` : ""}`),
      rpc<Stats>("automation_stats", { p_days: 7 }),
    ]);
  } catch {
    return (
      <div className="card notice">
        <h1>ยังไม่ได้รัน migration 006</h1>
        <p>รัน <code>python pipeline\migrate.py 006_automation_runs</code> แล้วรีเฟรชหน้านี้</p>
      </div>
    );
  }
  const okRate = stats.runs ? Math.round((stats.success / stats.runs) * 100) : null;
  const href = (p: Record<string, string | null>) => {
    const q = new URLSearchParams(Object.entries({ kind, status, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/runs${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>ประวัติการทำงาน</h1>
          <p>ทุกครั้งที่ AI หรือระบบอัตโนมัติทำงาน: ขั้นตอน เวลา สถานะ และจำนวน token ที่ใช้</p>
        </div>
      </div>

      <div className="grid kpis">
        <div className="card kpi"><div className="kpi-label">ทำงาน 7 วันล่าสุด</div><div className="kpi-value tabular">{count(stats.runs)} ครั้ง</div></div>
        <div className="card kpi"><div className="kpi-label">สำเร็จด้วย AI</div><div className="kpi-value tabular">{okRate === null ? "–" : `${okRate}%`}</div>
          <div className="kpi-foot"><span>ใช้สรุปจากระบบ {count(stats.fallback)} · ล้มเหลว {count(stats.failed)}</span></div></div>
        <div className="card kpi"><div className="kpi-label">เวลาเฉลี่ย</div><div className="kpi-value tabular">{secs(stats.avg_ms)}</div>
          <div className="kpi-foot"><span>95% เสร็จภายใน {secs(stats.p95_ms)}</span></div></div>
        <div className="card kpi"><div className="kpi-label">Token ที่ใช้</div><div className="kpi-value tabular">{count(stats.input_tokens + stats.output_tokens)}</div>
          <div className="kpi-foot"><span>ส่งเข้า {count(stats.input_tokens)} · ตอบกลับ {count(stats.output_tokens)}</span></div></div>
      </div>

      <div className="controls" style={{ marginBottom: 12 }}>
        <nav className="seg" aria-label="ประเภท">
          <a href={href({ kind: null })} aria-current={!kind ? "true" : undefined}>ทั้งหมด</a>
          {Object.entries(KIND_TH).map(([k, v]) => <a key={k} href={href({ kind: k })} aria-current={kind === k ? "true" : undefined}>{v}</a>)}
        </nav>
        <nav className="seg" aria-label="สถานะ">
          <a href={href({ status: null })} aria-current={!status ? "true" : undefined}>ทุกสถานะ</a>
          {Object.entries(STATUS).map(([k, v]) => <a key={k} href={href({ status: k })} aria-current={status === k ? "true" : undefined}>{v.label}</a>)}
        </nav>
      </div>

      <section className="card">
        {runs.length === 0 ? <p className="muted" style={{ margin: 0 }}>ยังไม่มีประวัติ ลองกด “สร้างสรุปด้วย AI” หรือถามผู้ช่วย AI ดู</p> : (
          <ul className="runs">
            {runs.map((r) => (
              <li key={r.id}>
                <details>
                  <summary>
                    <span className={`pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    <span className="run-title">
                      <strong>{KIND_TH[r.kind] ?? r.kind}</strong>
                      <span className="muted">{r.title ? ` · ${r.title}` : ""}</span>
                    </span>
                    <span className="muted run-meta">{when(r.started_at)} · {TRIGGER_TH[r.trigger] ?? r.trigger} · {secs(r.duration_ms)}
                      {r.input_tokens + r.output_tokens > 0 ? ` · ${count(r.input_tokens + r.output_tokens)} token` : ""}</span>
                  </summary>
                  <ol className="run-steps">
                    {r.steps.map((s, i) => (
                      <li key={i} className={s.status === "error" ? "error" : ""}>
                        <code>{s.name}</code>{s.ms ? <span className="muted"> · {secs(s.ms)}</span> : null}
                        {s.detail && <div className="muted">{s.detail}</div>}
                      </li>
                    ))}
                  </ol>
                  {r.model && <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>รุ่น AI: {r.model}</p>}
                  {r.error && <p className="error" style={{ fontSize: 13, margin: "4px 0 0" }}>{r.error}</p>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
