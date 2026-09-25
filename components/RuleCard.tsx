"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Message, Rule, RuleResult } from "@/lib/automations";
import { WEEKDAY_TH_SHORT } from "@/lib/labels";

type Meta = { label: string; description: string };

async function call(url: string, method: string, body?: object) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `ไม่สำเร็จ (${res.status})`);
  return data;
}

export default function RuleCard({ rule, meta, canEdit }: { rule: Rule; meta: Meta; canEdit: boolean }) {
  const router = useRouter();
  const [runAt, setRunAt] = useState(rule.run_at.slice(0, 5));
  const [days, setDays] = useState<number[]>(rule.days);
  const [channel, setChannel] = useState(rule.channel);
  const [target, setTarget] = useState(rule.target ?? "");
  const [threshold, setThreshold] = useState(rule.threshold === null ? "" : String(rule.threshold));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Message | null>(null);

  const act = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const save = () => act("save", () => call(`/api/automations/${rule.id}`, "PATCH", {
    run_at: runAt, days, channel, target: channel === "discord" ? target.trim() : null,
    ...(rule.kind === "money_gap" ? { threshold: threshold.trim() === "" ? null : Number(threshold) } : {}),
  }), "บันทึกแล้ว");

  const run = (dryRun: boolean) => act(dryRun ? "preview" : "run", async () => {
    const r = (await call(`/api/automations/${rule.id}`, "POST", { dryRun })) as RuleResult;
    setPreview(r.message ?? null);
    setMsg({ ok: r.status !== "failed", text: r.status === "skipped" ? `ไม่ต้องส่ง: ${r.detail}` : r.detail });
  });

  return (
    <section className={`card rule-card${rule.enabled ? "" : " rule-off"}`}>
      <div className="card-head">
        <div>
          <h2>{meta.label}</h2>
          <span className="sub">{meta.description}</span>
        </div>
        {canEdit && (
          <label className="switch">
            <input type="checkbox" checked={rule.enabled} disabled={busy !== null}
              onChange={(e) => act("toggle", () => call(`/api/automations/${rule.id}`, "PATCH", { enabled: e.target.checked }))} />
            <span>{rule.enabled ? "เปิดอยู่" : "ปิดอยู่"}</span>
          </label>
        )}
      </div>

      <fieldset disabled={!canEdit || busy !== null} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`t-${rule.id}`}>เวลา (เวลาไทย)</label>
            <input id={`t-${rule.id}`} className="input" type="time" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          </div>
          <div className="field">
            <span style={{ fontWeight: 600, fontSize: 14 }}>วัน</span>
            <div className="seg" role="group" aria-label="วันที่ทำงาน">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)}
                  onClick={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort()))}>
                  {WEEKDAY_TH_SHORT[d]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor={`c-${rule.id}`}>ส่งไปที่</label>
            <select id={`c-${rule.id}`} className="input" value={channel} onChange={(e) => setChannel(e.target.value as Rule["channel"])}>
              <option value="web">แจ้งเตือนในเว็บ</option>
              <option value="line">LINE (ทุกคนที่เชื่อมกับร้าน)</option>
              <option value="discord">Discord (ส่วนเสริม · ระยะถัดไป)</option>
            </select>
          </div>
          {rule.kind === "money_gap" && (
            <div className="field">
              <label htmlFor={`th-${rule.id}`}>เตือนเมื่อเงินขาดเกิน (บาท)</label>
              <input id={`th-${rule.id}`} className="input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
          )}
        </div>
        {channel === "line" && (
          <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>ส่งเข้า LINE ของทุกคนที่เชื่อมกับร้าน (ตั้งค่า → เชื่อม LINE) · แพ็กเกจฟรีของ LINE OA ส่งได้ประมาณ 300 ข้อความต่อเดือน</p>
        )}
        {channel === "discord" && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor={`w-${rule.id}`}>Discord webhook URL</label>
            <input id={`w-${rule.id}`} className="input" value={target} placeholder="https://discord.com/api/webhooks/..." onChange={(e) => setTarget(e.target.value)} />
            <span className="hint">Discord → ตั้งค่าห้อง → Integrations → Webhooks → New Webhook → Copy Webhook URL</span>
          </div>
        )}
        <div className="controls" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()}>{busy === "save" ? "กำลังบันทึก…" : "บันทึก"}</button>
          <button type="button" className="btn btn-sm" onClick={() => void run(true)}>{busy === "preview" ? "…" : "ดูตัวอย่างข้อความ"}</button>
          <button type="button" className="btn btn-sm" onClick={() => void run(false)}>{busy === "run" ? "…" : "รันตอนนี้"}</button>
          <button type="button" className="btn btn-sm btn-ghost"
            onClick={() => confirm("ลบกฎนี้?") && void act("delete", () => call(`/api/automations/${rule.id}`, "DELETE"))}>ลบ</button>
        </div>
      </fieldset>

      <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
        {rule.last_fired_on ? `รันตามเวลาล่าสุด ${rule.last_fired_on}` : "ยังไม่เคยรันตามเวลา"}
        {rule.last_status ? ` · ผลล่าสุด: ${{ sent: "ส่งแล้ว", skipped: "ไม่ต้องส่ง", failed: "ล้มเหลว", preview: "ดูตัวอย่าง" }[rule.last_status] ?? rule.last_status}` : ""}
      </p>
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-err"}`} style={{ marginTop: 10, marginBottom: 0 }}><div>{msg.text}</div></div>}
      {preview && (
        <div className="message-preview">
          <strong>{preview.title}</strong>
          <div>{preview.body}</div>
        </div>
      )}
    </section>
  );
}
