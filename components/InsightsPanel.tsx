"use client";
import { useState } from "react";
import type { Insight, Lang } from "@/lib/types";

export default function InsightsPanel({ start, end }: { start: string; end: string }) {
  const [lang, setLang] = useState<Lang>("th");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Insight | null>(null);

  async function generate(l: Lang = lang) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end, lang: l }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `คำขอล้มเหลว (${res.status})`);
      setResult(data as Insight);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function switchLang(l: Lang) {
    setLang(l);
    if (result) void generate(l);
  }

  return (
    <section className="card ai-card" aria-live="polite" aria-busy={loading}>
      <div className="card-head" style={{ alignItems: "center" }}>
        <div className="ai-title">
          <span className="ai-icon" aria-hidden="true">✨</span>
          <div>
            <h2>สรุปด้วย AI</h2>
            <span className="sub">ตัวเลขและคำว่าเพิ่ม/ลด ระบบเติมจากฐานข้อมูล AI เป็นผู้เรียบเรียง</span>
          </div>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="ภาษาของสรุป">
            <button type="button" aria-pressed={lang === "th"} onClick={() => switchLang("th")}>ไทย</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => switchLang("en")}>English</button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => generate()} disabled={loading}>
            {loading ? "กำลังวิเคราะห์…" : result ? "↻ สรุปใหม่" : "✨ สร้างสรุปด้วย AI"}
          </button>
        </div>
      </div>

      {!result && !error && !loading && (
        <p className="ai-intro">
          SQL เป็นผู้คำนวณและหาว่าส่วนไหนทำให้รายได้เปลี่ยน AI เลือกว่าจะเล่าเรื่องไหนและเรียบเรียงเป็นภาษาคน
          แต่เขียนตัวเลขหรือคำว่าเพิ่มขึ้น/ลดลงเองไม่ได้ ระบบเป็นผู้เติมให้ ถ้า AI ฝ่าฝืน ระบบจะใช้สรุปจากระบบแทน
          ส่วนการตีความและคำแนะนำยังควรให้คนตรวจก่อนตัดสินใจ
        </p>
      )}
      {loading && !result && (
        <div aria-hidden="true">
          <div className="skeleton-line" style={{ width: "60%", height: 16 }} />
          <div className="skeleton-line" style={{ width: "90%" }} />
          <div className="skeleton-line" style={{ width: "82%" }} />
          <div className="skeleton-line" style={{ width: "70%" }} />
        </div>
      )}
      {error && <div className="alert alert-err" style={{ margin: 0 }}><span aria-hidden="true">⚠️</span><div>สร้างสรุปไม่สำเร็จ: {error}</div></div>}

      {result && (
        <div className="ai-body" style={{ opacity: loading ? 0.5 : 1 }}>
          <h3>{result.headline}</h3>
          <ul>{result.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <div className="ai-next"><strong>{lang === "th" ? "ควรทำต่อ:" : "Next step:"}</strong> {result.recommendation}</div>
          <div className="controls" style={{ marginTop: 12 }}>
            {result.source === "ai" ? (
              <span className="badge badge-ok">✓ สรุปโดย AI · ตัวเลขและทิศทางเติมจากฐานข้อมูล</span>
            ) : (
              <span className="badge">สรุปจากระบบ (ไม่ใช้ AI)</span>
            )}
            {result.model && <span className="badge">{result.model}</span>}
            {result.cached && <span className="badge">ใช้ผลที่บันทึกไว้</span>}
          </div>
          {result.note && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{result.note}</p>}
        </div>
      )}
    </section>
  );
}
