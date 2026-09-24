"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { FIELDS, guessMapping, toLineItems, type Cell, type DateOrder, type Field, type Mapping } from "@/lib/importer";
import { count, currencySymbol, money } from "@/lib/format";

type Status = { needsPassword: boolean; passwordConfigured: boolean; production: boolean; configured: boolean; ready: boolean };
type Workbook = { name: string; sheets: { name: string; rows: Cell[][] }[] };
type Sheet = { headers: string[]; rows: Cell[][] };
type Result = { inserted_rows: number; skipped_rows: number };

const CHUNK = 2000;
const MAX_ROWS = 300_000;
const ORDER_LABEL: Record<DateOrder, string> = { DMY: "วัน/เดือน/ปี", MDY: "เดือน/วัน/ปี (แบบอเมริกา)" };

async function readCsv(file: File): Promise<Cell[][]> {
  const buf = await file.arrayBuffer();
  let textData: string;
  try {
    textData = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    textData = new TextDecoder("windows-874").decode(buf);     // CSV saved by Thai Excel (TIS-620)
  }
  return Papa.parse<string[]>(textData.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data;
}

async function readXlsx(file: File): Promise<{ name: string; rows: Cell[][] }[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }));
}

function cellPreview(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 16);
  return String(v);
}

/** First row with 2+ filled cells is the header. */
function toSheet(rows: Cell[][]): Sheet | string {
  const headerIdx = rows.findIndex((r) => r && r.filter((c) => c !== null && c !== "").length >= 2);
  if (headerIdx < 0) return "ไม่พบหัวตารางในชีตนี้ แถวแรกที่มีข้อมูลต้องเป็นชื่อคอลัมน์";
  const data = rows.slice(headerIdx + 1);
  if (data.length === 0) return "ชีตนี้มีแต่หัวตาราง ไม่มีข้อมูล";
  if (data.length > MAX_ROWS) return `ชีตนี้ใหญ่เกินไป (${count(data.length)} แถว) รองรับได้สูงสุด ${count(MAX_ROWS)} แถวต่อครั้ง`;
  return { headers: rows[headerIdx].map((h) => cellPreview(h).trim()), rows: data };
}

/** What to call the region column, from its header: COUNTRY -> ประเทศ, สาขา -> สาขา, ... */
function regionNameFor(header: string | undefined): string {
  const h = (header ?? "").toLowerCase();
  if (/country|ประเทศ/.test(h)) return "ประเทศ";
  if (/territory|ภาค|ภูมิภาค|region/.test(h)) return "ภูมิภาค";
  if (/province|จังหวัด/.test(h)) return "จังหวัด";
  if (/state|รัฐ/.test(h)) return "รัฐ";
  if (/city|เมือง/.test(h)) return "เมือง";
  if (/store|shop|ร้าน/.test(h)) return "ร้าน";
  return "สาขา";
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `นำเข้าไม่สำเร็จ (${res.status})`);
  return data;
}

function Capability({ ok, label, why }: { ok: boolean; label: string; why: string }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span aria-hidden="true" className={ok ? "delta-up" : "muted"}>{ok ? "✓" : "–"}</span>
      <span><strong style={{ fontWeight: 600 }}>{label}</strong>{" "}
        <span className="muted" style={{ fontSize: 13 }}>{ok ? "คำนวณได้" : `แสดงเป็น “ไม่มีข้อมูล” (${why})`}</span></span>
    </li>
  );
}

export default function ImportClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [book, setBook] = useState<Workbook | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateOrder, setDateOrder] = useState<"auto" | DateOrder>("auto");
  const [drag, setDrag] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [currency, setCurrency] = useState("THB");
  const [regionLabel, setRegionLabel] = useState("สาขา");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; step: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/import").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  const sheet = useMemo(() => {
    const s = book?.sheets[sheetIdx];
    return s ? toSheet(s.rows) : null;
  }, [book, sheetIdx]);

  function applySheet(s: Sheet | string | null) {
    if (!s || typeof s === "string") return;
    const guessed = guessMapping(s.headers);
    setMapping(guessed);
    setDateOrder("auto");
    setRegionLabel(regionNameFor(guessed.region === undefined ? undefined : s.headers[guessed.region]));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReadError(null); setBook(null); setResult(null); setUploadError(null); setProgress(null);
    setReading(true);
    try {
      const lower = file.name.toLowerCase();
      let sheets: Workbook["sheets"];
      if (lower.endsWith(".csv") || lower.endsWith(".txt")) sheets = [{ name: "CSV", rows: await readCsv(file) }];
      else if (lower.endsWith(".xlsx")) sheets = await readXlsx(file);
      else throw new Error("รองรับเฉพาะไฟล์ .csv และ .xlsx (ถ้าเป็น .xls ให้เปิดใน Excel แล้ว “บันทึกเป็น” .xlsx ก่อน)");
      // start on the sheet with the most rows (skips "Guide" / "README" sheets)
      const best = sheets.reduce((b, s, i) => (s.rows.length > sheets[b].rows.length ? i : b), 0);
      const first = toSheet(sheets[best].rows);
      if (typeof first === "string" && sheets.length === 1) throw new Error(first);
      setBook({ name: file.name, sheets });
      setSheetIdx(best);
      applySheet(first);
      setDatasetName(file.name.replace(/\.(csv|xlsx|txt)$/i, ""));
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  const ready = sheet && typeof sheet !== "string" ? sheet : null;
  const parsed = useMemo(
    () => (ready ? toLineItems(ready.rows, mapping, dateOrder === "auto" ? undefined : dateOrder) : null),
    [ready, mapping, dateOrder],
  );
  const missingRequired = mapping.ordered_at === undefined || (mapping.total === undefined && mapping.unit_price === undefined);
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    parsed?.rejected.forEach((r) => m.set(r.reason, (m.get(r.reason) ?? 0) + 1));
    return [...m.entries()];
  }, [parsed]);

  async function upload() {
    if (!parsed || parsed.items.length === 0 || !book) return;
    setUploadError(null); setResult(null);
    const items = parsed.items;
    const total = items.length;
    let batch: number | null = null;
    setProgress({ done: 0, total, step: "เริ่มนำเข้า" });
    try {
      const begin = await post({
        action: "begin", password,
        meta: {
          file_name: book.name, mode, expected_rows: total,
          has_order_ids: parsed.stats.hasOrderIds, has_customer_ids: parsed.stats.hasCustomerIds,
          has_quantity: parsed.stats.hasQuantity,
          currency, region_label: regionLabel, dataset_name: datasetName,
        },
      });
      batch = begin.batch_id as number;
      for (let i = 0; i < total; i += CHUNK) {
        await post({ action: "chunk", password, batch_id: batch, items: items.slice(i, i + CHUNK) });
        setProgress({ done: Math.min(total, i + CHUNK), total, step: "กำลังส่งข้อมูล" });
      }
      setProgress({ done: total, total, step: "กำลังตรวจยอดและบันทึก" });
      setResult(await post({ action: "commit", password, batch_id: batch }) as Result);
    } catch (e) {
      setUploadError((e as Error).message);
      if (batch !== null) await post({ action: "abort", password, batch_id: batch }).catch(() => undefined);
    }
  }

  const busy = progress !== null && !result && !uploadError;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;
  const s = parsed?.stats;

  return (
    <div className="stack">
      {status && !status.configured && (
        <div className="alert alert-err"><span aria-hidden="true">⚠️</span><div>ยังไม่ได้ตั้งค่า Supabase ใน <code>web/.env.local</code></div></div>
      )}
      {status && status.configured && !status.ready && (
        <div className="alert alert-warn">
          <span aria-hidden="true">⚠️</span>
          <div><strong>ต้องรัน migration 004 ก่อน</strong><p>เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ แล้วรัน <code>python pipeline/migrate.py</code></p></div>
        </div>
      )}

      {/* ---------- 1. file ---------- */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>1. เลือกไฟล์ยอดขาย</h2>
            <span className="sub">รองรับ .csv และ .xlsx (เลือกชีตได้) หัวตารางไทยหรืออังกฤษก็ได้ ไฟล์ถูกอ่านในเบราว์เซอร์ของคุณก่อน</span>
          </div>
          <div className="controls">
            <a className="btn btn-sm" href="/samples/sales-template.csv" download>⬇ เทมเพลตเปล่า</a>
          </div>
        </div>
        <div
          className={`dropzone${drag ? " drag" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="เลือกไฟล์ยอดขาย หรือลากไฟล์มาวางที่นี่"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0]); }}
        >
          <strong>{reading ? "กำลังอ่านไฟล์…" : book ? `📄 ${book.name}` : "ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์"}</strong>
          <span className="muted">
            {ready ? `${count(ready.rows.length)} แถว · ${ready.headers.length} คอลัมน์ · คลิกเพื่อเปลี่ยนไฟล์` : "CSV (UTF-8 หรือไฟล์ที่บันทึกจาก Excel ภาษาไทย) หรือ Excel .xlsx"}
          </span>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.txt" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {book && book.sheets.length > 1 && (
          <div className="field" style={{ marginTop: 14, maxWidth: 420 }}>
            <label htmlFor="sheet">ชีตที่มีข้อมูลยอดขาย</label>
            <select id="sheet" className="input" value={sheetIdx}
              onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); applySheet(toSheet(book.sheets[i].rows)); }}>
              {book.sheets.map((sh, i) => <option key={i} value={i}>{sh.name} ({count(Math.max(0, sh.rows.length - 1))} แถว)</option>)}
            </select>
            <span className="hint">ระบบเลือกชีตที่มีข้อมูลมากที่สุดให้ก่อน ถ้าไม่ใช่ชีตยอดขายให้เปลี่ยนที่นี่</span>
          </div>
        )}
        {(readError || typeof sheet === "string") && (
          <div className="alert alert-err" style={{ marginTop: 12, marginBottom: 0 }}><span aria-hidden="true">⚠️</span><div>{readError ?? (typeof sheet === "string" ? sheet : "")}</div></div>
        )}
      </section>

      {ready && parsed && s && (
        <>
          {/* ---------- 2. columns ---------- */}
          <section className="card">
            <div className="card-head">
              <div>
                <h2>2. ตรวจว่าคอลัมน์ตรงกับข้อมูลอะไร</h2>
                <span className="sub">ระบบเดาให้อัตโนมัติจากชื่อหัวตาราง ถ้าไม่ถูกเลือกใหม่ได้ ต้องมีอย่างน้อย “วันที่” และ “ยอดขาย” หรือ “ราคา”</span>
              </div>
            </div>
            <div className="table-scroll" style={{ maxHeight: "none" }}>
              <table className="dtable">
                <thead><tr><th scope="col">ข้อมูล</th><th scope="col" style={{ textAlign: "left" }}>คอลัมน์ในไฟล์</th><th scope="col" style={{ textAlign: "left" }}>ตัวอย่างค่า</th></tr></thead>
                <tbody>
                  {FIELDS.map((f) => {
                    const idx = mapping[f.id];
                    const sample = idx === undefined ? "" : ready.rows.slice(0, 3).map((r) => cellPreview(r[idx])).filter(Boolean).join(" · ");
                    return (
                      <tr key={f.id}>
                        <td style={{ minWidth: 170 }}>
                          <strong style={{ fontWeight: 600 }}>{f.label}{f.id === "ordered_at" && <span className="error"> *</span>}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>{f.hint}</div>
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <select
                            className="input"
                            aria-label={`คอลัมน์สำหรับ ${f.label}`}
                            value={idx ?? ""}
                            onChange={(e) => setMapping((m) => {
                              const next = { ...m };
                              if (e.target.value === "") delete next[f.id as Field];
                              else next[f.id as Field] = Number(e.target.value);
                              return next;
                            })}
                          >
                            <option value="">— ไม่มี —</option>
                            {ready.headers.map((h, i) => <option key={i} value={i}>{h || `คอลัมน์ ${i + 1}`}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: "left", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="field" style={{ marginTop: 16, maxWidth: 420 }}>
              <label htmlFor="dord">รูปแบบวันที่ในไฟล์</label>
              <select id="dord" className="input" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "auto" | DateOrder)}>
                <option value="auto">อัตโนมัติ (ตรวจพบ: {ORDER_LABEL[s.dateOrder]})</option>
                <option value="DMY">{ORDER_LABEL.DMY} เช่น 24/05/2567</option>
                <option value="MDY">{ORDER_LABEL.MDY} เช่น 05/24/2024</option>
              </select>
              <span className="hint">
                {s.dateOrderSure
                  ? "ระบบดูจากทุกแถวในคอลัมน์ (เช่น มีวันที่ 24 อยู่ตำแหน่งไหน) ปกติไม่ต้องเปลี่ยน"
                  : "⚠️ ทุกวันที่ในไฟล์ไม่เกินวันที่ 12 ระบบจึงแยกไม่ออก กรุณาตรวจว่าถูกต้อง"}
              </span>
            </div>

            <div className="grid three" style={{ marginTop: 16 }}>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="kpi-label">รายการที่จะนำเข้า</div>
                <div className="kpi-value tabular" style={{ fontSize: 24 }}>{count(s.rows)}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {s.orders === null ? "ไม่มีเลขบิล" : `${count(s.orders)} บิล`}
                  {s.canceled ? ` · ยกเลิก ${count(s.canceled)} รายการ (ไม่นับรายได้)` : ""}
                </div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="kpi-label">ยอดขายรวม</div>
                <div className="kpi-value tabular" style={{ fontSize: 24 }}>{money(s.revenue, currencySymbol(currency))}</div>
                <div className="muted" style={{ fontSize: 13 }}>{s.minDate ? `${s.minDate} ถึง ${s.maxDate}` : "ยังไม่มีวันที่ที่อ่านได้"}</div>
              </div>
              <div className="card" style={{ boxShadow: "none" }}>
                <div className="kpi-label">แถวที่ข้าม</div>
                <div className={`kpi-value tabular ${parsed.rejected.length ? "error" : ""}`} style={{ fontSize: 24 }}>{count(parsed.rejected.length)}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {reasons.length ? reasons.map(([r, n]) => `${r} ${count(n)}`).join(" · ") : "ไม่มีแถวที่ผิด"}
                  {s.zeroRows ? ` · ยอดเป็น 0 (ไม่มีขาย) ${count(s.zeroRows)} แถว ไม่ต้องบันทึก` : ""}
                </div>
              </div>
            </div>
            {parsed.rejected.length > 0 && (
              <details className="table-view">
                <summary>ดูแถวที่ข้าม (แสดงสูงสุด 20 แถว)</summary>
                <ul style={{ margin: "8px 0 0", fontSize: 13 }}>
                  {parsed.rejected.slice(0, 20).map((r) => <li key={r.row}>แถวที่ {r.row}: {r.reason}</li>)}
                </ul>
              </details>
            )}

            <div style={{ marginTop: 16 }}>
              <strong style={{ fontWeight: 600 }}>ตัวเลขที่ไฟล์นี้บอกได้</strong>
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 4 }}>
                <Capability ok label="รายได้ · สินค้าขายดี/ขายน้อย · หมวดสินค้า" why="" />
                <Capability ok={s.hasOrderIds} label="จำนวนบิล · ยอดเฉลี่ยต่อบิล" why="ไม่มีคอลัมน์เลขบิล จึงไม่รู้ว่าแถวไหนอยู่บิลเดียวกัน" />
                <Capability ok={s.hasCustomerIds} label="จำนวนลูกค้า" why="ไม่มีคอลัมน์รหัสลูกค้า" />
                <Capability ok={s.hasQuantity} label="จำนวนชิ้นที่ขาย" why="ไม่มีคอลัมน์จำนวน" />
                <Capability ok={s.hasTime} label="ยอดขายตามชั่วโมง" why="มีแต่วันที่ ไม่มีเวลา" />
                <Capability ok={s.hasRegion} label="ยอดขายตามสาขา / พื้นที่" why="ไม่มีคอลัมน์สาขา" />
              </ul>
            </div>
          </section>

          {/* ---------- 3. settings + upload ---------- */}
          <section className="card">
            <div className="card-head">
              <div>
                <h2>3. ตั้งค่าและนำเข้า</h2>
                <span className="sub">หลังนำเข้าเสร็จ dashboard, สรุป AI และรายงานอีเมลจะใช้ข้อมูลชุดนี้ทันที</span>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="ds">ชื่อชุดข้อมูล</label>
                <input id="ds" className="input" value={datasetName} maxLength={60} onChange={(e) => setDatasetName(e.target.value)} />
                <span className="hint">แสดงที่หัว dashboard เช่น “ร้านกาแฟ 3 สาขา”</span>
              </div>
              <div className="field">
                <label htmlFor="cur">สกุลเงิน</label>
                <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="THB">บาท (฿)</option>
                  <option value="USD">ดอลลาร์สหรัฐ ($)</option>
                  <option value="EUR">ยูโร (€)</option>
                  <option value="JPY">เยน (¥)</option>
                  <option value="GBP">ปอนด์ (£)</option>
                  <option value="BRL">เรอัลบราซิล (R$)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="rl">เรียกคอลัมน์ “สาขา / พื้นที่” ว่า</label>
                <input id="rl" className="input" value={regionLabel} maxLength={40} onChange={(e) => setRegionLabel(e.target.value)} />
                <span className="hint">เช่น สาขา, จังหวัด, ประเทศ</span>
              </div>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
              <legend style={{ fontWeight: 600, marginBottom: 8 }}>วิธีนำเข้า</legend>
              <div className="radio-cards">
                <label className="radio-card">
                  <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                  <div><strong>แทนที่ข้อมูลเดิมทั้งหมด</strong><span>ข้อมูลเก่าจะถูกแทนที่ก็ต่อเมื่อไฟล์นี้เข้าครบทุกแถวแล้วเท่านั้น</span></div>
                </label>
                <label className="radio-card">
                  <input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} />
                  <div><strong>เพิ่มต่อจากข้อมูลเดิม</strong><span>ไม่แก้ข้อมูลเดิม บิลที่เลขซ้ำกับของเดิมจะถูกข้ามและแจ้งจำนวนให้ทราบ</span></div>
                </label>
              </div>
            </fieldset>

            {status?.needsPassword && (
              <div className="field" style={{ marginTop: 16, maxWidth: 360 }}>
                <label htmlFor="pw">รหัสผ่านผู้ดูแล</label>
                <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <span className="hint">
                  {status.passwordConfigured ? "ค่า ADMIN_PASSWORD ที่ตั้งไว้ในเซิร์ฟเวอร์" : "เซิร์ฟเวอร์ยังไม่ได้ตั้ง ADMIN_PASSWORD จึงนำเข้าไม่ได้"}
                </span>
              </div>
            )}

            <div className="controls" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={upload}
                disabled={busy || missingRequired || parsed.items.length === 0 || (status !== null && !status.ready)}
              >
                {busy ? `${progress?.step}… ${pct}%` : `นำเข้า ${count(parsed.items.length)} รายการ`}
              </button>
              {missingRequired && <span className="error" style={{ fontSize: 13 }}>ต้องเลือกคอลัมน์วันที่ และยอดขายหรือราคา</span>}
            </div>

            {progress && !result && !uploadError && (
              <div style={{ marginTop: 14 }} aria-live="polite">
                <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="ความคืบหน้าการนำเข้า">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>{progress.step} · {count(progress.done)} / {count(progress.total)} รายการ</p>
              </div>
            )}
            {uploadError && (
              <div className="alert alert-err" style={{ marginTop: 12, marginBottom: 0 }}>
                <span aria-hidden="true">⚠️</span>
                <div>
                  {uploadError}
                  <p>ยกเลิกการนำเข้าครั้งนี้แล้ว ข้อมูลเดิมในระบบยังอยู่ครบ ไม่ถูกลบหรือแก้ไข</p>
                </div>
              </div>
            )}
            {result && (
              <div className="alert alert-ok" style={{ marginTop: 12, marginBottom: 0 }}>
                <span aria-hidden="true">✅</span>
                <div>
                  <strong>นำเข้าสำเร็จ {count(result.inserted_rows)} รายการ</strong>
                  {result.skipped_rows > 0 && <p>ข้าม {count(result.skipped_rows)} รายการ เพราะเลขบิลซ้ำกับข้อมูลที่มีอยู่แล้ว (ข้อมูลเดิมไม่ถูกแก้)</p>}
                  <p><a href="/analytics?range=all">เปิดหน้าวิเคราะห์ไฟล์ที่นำเข้า →</a></p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
