"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentAnswer } from "@/lib/agent";

type Scope = { id: string; label: string; kind: "dataset" | "shop" };

const SUGGESTIONS: Record<Scope["kind"], string[]> = {
  shop: [
    "เมื่อวานได้กำไรเท่าไหร่ เงินขาดไหม",
    "4 สัปดาห์ล่าสุด เมนูไหนทำกำไรมากที่สุด",
    "พรุ่งนี้ควรเตรียมอะไรบ้าง",
    "วันไหนในสัปดาห์ขายดีที่สุด",
  ],
  dataset: [
    "เดือนล่าสุดยอดขายเป็นยังไง เทียบเดือนก่อน",
    "อะไรทำให้รายได้ 30 วันล่าสุดเปลี่ยน",
    "เมื่อวานยอดขายผิดปกติไหม",
    "หมวดสินค้าไหนขายดีที่สุดใน 90 วันล่าสุด",
  ],
};

const TOOL_TH: Record<string, string> = {
  sales_summary: "สรุปยอดขายช่วงวันที่",
  daily_report: "รายงานรายวัน",
  shop_day: "ตัวเลขของร้านรายวัน",
  shop_period: "ภาพรวมของร้านช่วงวันที่",
  shop_forecast: "คาดการณ์ของที่ควรเตรียม",
};

export default function AssistantClient({ scopes, initialQuestion = "" }: { scopes: Scope[]; initialQuestion?: string }) {
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? "");
  const [question, setQuestion] = useState(initialQuestion);
  const asked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ q: string; a: AgentAnswer; ms: number } | null>(null);
  const scope = scopes.find((s) => s.id === scopeId);

  async function ask(q: string) {
    if (!q.trim() || !scope) return;
    setBusy(true); setErr(null);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, scope: scope.kind === "dataset" ? "dataset" : scope.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `ถามไม่สำเร็จ (${res.status})`);
      setResult({ q, a: data as AgentAnswer, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // a question typed on the home page arrives as ?q= and is asked straight away
  useEffect(() => {
    if (initialQuestion && !asked.current) { asked.current = true; void ask(initialQuestion); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (scopes.length === 0) {
    return <div className="card notice"><p style={{ margin: 0 }}>ยังไม่มีข้อมูลให้ถาม เริ่มจาก <a href="/">หน้าหลัก</a> เพื่อสร้างร้านหรือลองร้านตัวอย่างก่อน</p></div>;
  }

  return (
    <div className="stack">
      <section className="card ai-card">
        <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="stack" style={{ gap: 12 }}>
          {scopes.length > 1 && (
            <div className="controls">
              <label htmlFor="scope" className="muted" style={{ fontSize: 13 }}>ถามเกี่ยวกับ</label>
              <select id="scope" className="input" value={scopeId} onChange={(e) => { setScopeId(e.target.value); setResult(null); }}>
                {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          )}
          <div className="ask-row">
            <input className="input" style={{ flex: 1, fontSize: 16 }} value={question} maxLength={400}
              placeholder="พิมพ์คำถาม เช่น เมนูไหนทำกำไรมากที่สุดเดือนนี้" aria-label="คำถาม"
              onChange={(e) => setQuestion(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>{busy ? "กำลังคิด…" : "ถาม"}</button>
          </div>
          {scope && (
            <div className="chips">
              {SUGGESTIONS[scope.kind].map((s) => (
                <button key={s} type="button" className="chip chip-btn" disabled={busy} onClick={() => { setQuestion(s); void ask(s); }}>{s}</button>
              ))}
            </div>
          )}
        </form>
      </section>

      {busy && (
        <section className="card" aria-busy="true">
          <p className="muted" style={{ margin: 0 }}>กำลังดูข้อมูลร้านให้…</p>
          <div className="skeleton-line" style={{ width: "70%" }} /><div className="skeleton-line" style={{ width: "85%" }} />
        </section>
      )}
      {err && <div className="alert alert-err"><span aria-hidden="true">⚠️</span><div>{err}</div></div>}

      {result && !busy && (
        <section className="card" aria-live="polite">
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>คำถาม: {result.q}</div>
          <div className="answer">{result.a.answer}</div>
          <div className="controls" style={{ marginTop: 12 }}>
            {result.a.source === "ai"
              ? <span className="badge badge-ok">✓ ตัวเลขมาจากข้อมูลร้านจริง</span>
              : result.a.source === "facts"
                ? <span className="badge">แสดงข้อมูลที่ดึงมา (AI เรียบเรียงไม่ผ่านการตรวจ)</span>
                : <span className="badge">ไม่มีข้อมูลที่ตอบได้</span>}

          </div>
          <details className="table-view">
            <summary>ดูว่า AI ดึงข้อมูลอะไรมาตอบ</summary>
            <ol className="steps" style={{ marginTop: 10 }}>
              {result.a.tools.map((t, i) => (
                <li key={i}>
                  <h3>{TOOL_TH[t.name] ?? t.name} <code style={{ fontSize: 12 }}>{t.name}</code></h3>
                  <p>
                    {Object.entries(t.args).map(([k, v]) => `${k} = ${String(v)}`).join(", ") || "ไม่มีพารามิเตอร์"}
                    {" · "}{t.ok ? `ได้ข้อเท็จจริง ${t.facts} รายการ` : <span className="error">ผิดพลาด: {t.error}</span>} · {t.ms} ms
                  </p>
                </li>
              ))}
              <li><h3>ตรวจคำตอบ</h3><p>AI เขียนได้แค่ช่องว่าง ระบบตรวจว่าไม่มีตัวเลขหรือคำบอกทิศทางที่ AI พิมพ์เอง แล้วจึงเติมค่าจริง</p></li>
            </ol>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{result.a.model ? `${result.a.model} · ` : ""}{(result.ms / 1000).toFixed(1)} วินาที · <a href="/runs">ประวัติการทำงาน</a></p>
          </details>
        </section>
      )}
    </div>
  );
}
