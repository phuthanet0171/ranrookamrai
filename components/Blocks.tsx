// Server-rendered building blocks (no client JS needed).
import type { ReactNode } from "react";
import type { BreakdownRow, DriverSegment, Drivers, RankRow } from "@/lib/types";
import { count, money, pct } from "@/lib/format";
import { dimensionLabel, segmentLabel } from "@/lib/labels";

export function Card({ title, sub, action, children, className = "" }: {
  title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <span className="sub">{sub}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** ▲ +4.4% pill. Arrow + sign repeat the color. */
export function DeltaPill({ value, unit = "%" }: { value: number | null; unit?: "%" | "pts" }) {
  if (value === null) return <span className="pill pill-flat">ไม่มีข้อมูลเทียบ</span>;
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const text = `${up ? "+" : ""}${value.toFixed(1)}${unit === "%" ? "%" : " จุด"}`;
  return (
    <span className={`pill ${flat ? "pill-flat" : up ? "pill-up" : "pill-down"}`}>
      <span aria-hidden="true">{flat ? "●" : up ? "▲" : "▼"}</span> {text}
    </span>
  );
}

const ICONS: Record<string, ReactNode> = {
  revenue: <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  orders: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18M16 10a4 4 0 0 1-8 0" /></>,
  aov: <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></>,
  customers: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  delivery: <><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
};

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 84, h = 28, max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join("");
  return (
    <svg className="spark" width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function KpiTile({ icon, label, value, delta, suffix, unit, spark, missing }: {
  icon: keyof typeof ICONS; label: string; value: string; delta: number | null; suffix: string;
  unit?: "%" | "pts"; spark?: number[];
  missing?: string;             // set when the data cannot answer this KPI: why, in Thai
}) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <div className="kpi-label">
          <span className="kpi-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
          </span>
          {label}
        </div>
      </div>
      {spark && !missing && <Sparkline values={spark} />}
      {missing ? (
        <>
          <div className="kpi-value muted" style={{ fontSize: 20 }}>ไม่มีข้อมูล</div>
          <div className="kpi-foot"><span>{missing}</span></div>
        </>
      ) : (
        <>
          <div className="kpi-value tabular">{value}</div>
          <div className="kpi-foot"><DeltaPill value={delta} unit={unit} /> <span>{suffix}</span></div>
        </>
      )}
    </div>
  );
}

/** Horizontal bars with the value written next to each bar. Rows arrive already labelled. */
export function BarList({ rows, showOrders = true }: { rows: BreakdownRow[]; showOrders?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  if (rows.length === 0) return <p className="muted">ไม่มียอดขายในช่วงนี้</p>;
  return (
    <div className="barlist">
      {rows.map((r) => {
        const other = r.key === "Other";
        const width = Math.min(100, (r.revenue / max) * 100);
        return (
          <div className="bar-row" key={r.key} title={`${r.label}: ${money(r.revenue)}${showOrders ? ` · ${count(r.orders)} คำสั่งซื้อ` : ""}`}>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track"><span className={`bar-fill${other ? " other" : ""}`} style={{ width: `${width}%`, display: "block" }} /></span>
            <span className="bar-value">{money(r.revenue)} <span className="muted">· {r.share ?? 0}%</span></span>
          </div>
        );
      })}
    </div>
  );
}

/** Numbered ranking with growth vs the previous period. */
export function RankList({ rows, empty, showOrders = true }: { rows: RankRow[]; empty: string; showOrders?: boolean }) {
  if (rows.length === 0) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ol className="rank">
      {rows.map((r, i) => (
        <li key={r.key}>
          <span className="rank-no">{i + 1}</span>
          <span style={{ minWidth: 0 }}>
            <span className="rank-name" title={r.label} style={{ display: "block" }}>{r.label}</span>
            <span className="rank-meta">{showOrders ? `${count(r.orders)} คำสั่งซื้อ · ` : ""}{r.share ?? 0}% ของรายได้</span>
          </span>
          <span className="rank-val">
            {money(r.revenue)}
            <small className={r.change_pct === null || Math.abs(r.change_pct) < 0.05 ? "muted" : r.change_pct < 0 ? "delta-down" : "delta-up"}>
              {r.change_pct === null ? (r.prev_revenue === 0 ? "ใหม่ในช่วงนี้" : "–")
                : Math.abs(r.change_pct) < 0.05 ? "● ไม่เปลี่ยน"
                : `${r.change_pct < 0 ? "▼" : "▲"} ${pct(r.change_pct)}`}
            </small>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Diverging bars: red to the left = lost revenue, blue to the right = gained. Arrows repeat the sign. */
export function DriversChart({ drivers, baselineLabel, region, limit = 8 }: {
  drivers: Drivers; baselineLabel: string; region: string; limit?: number;
}) {
  // segments that pushed revenue in the same direction as the total first, then the biggest offsets
  const falling = drivers.total_change < 0;
  const same = drivers.segments.filter((s) => (s.change < 0) === falling);
  const opposite = drivers.segments.filter((s) => (s.change < 0) !== falling);
  const nOpp = Math.min(2, opposite.length);
  const segs = [...same.slice(0, limit - nOpp), ...opposite.slice(0, nOpp)];
  const max = Math.max(1, ...segs.map((s) => Math.abs(s.change)));
  const name = (s: DriverSegment) => segmentLabel(s.dimension, s.segment);
  const dim = (s: DriverSegment) => dimensionLabel(s.dimension, "th", region);
  if (segs.length === 0) return <p className="muted">ช่วงนี้รายได้ไม่เปลี่ยนแปลง จึงไม่มีส่วนที่ต้องอธิบาย</p>;
  return (
    <>
      <p style={{ margin: "0 0 12px" }}>
        รายได้เปลี่ยนไปเมื่อเทียบกับ{baselineLabel}{" "}
        <strong className={drivers.total_change < 0 ? "delta-down" : "delta-up"}>
          {drivers.total_change < 0 ? "▼ " : "▲ "}{money(Math.abs(drivers.total_change))} ({pct(drivers.total_change_pct, "ไม่มีข้อมูล")})
        </strong>
      </p>
      <div className="drivers">
        {segs.map((s) => {
          const w = `${(Math.abs(s.change) / max) * 100}%`;
          const down = s.change < 0;
          return (
            <div className="drv-row" key={`${s.dimension}:${s.segment}`}>
              <span className="drv-name" title={name(s)}>
                {name(s)}
                <span className="drv-dim">{dim(s)}</span>
              </span>
              <span className="drv-track" aria-hidden="true">
                <span className="drv-neg">{down && <div style={{ width: w }} />}</span>
                <span className="drv-pos">{!down && <div style={{ width: w }} />}</span>
              </span>
              <span className="drv-val">
                <span className={down ? "delta-down" : "delta-up"}>{down ? "▼" : "▲"} {money(Math.abs(s.change))}</span>
                <span className="muted"> {pct(s.change_pct, "")}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
        แต่ละแถวเทียบกับ{baselineLabel} แถบสีแดง = รายได้ที่หายไป แถบสีน้ำเงิน = รายได้ที่เพิ่มขึ้น
        สัดส่วนของการเปลี่ยนแปลงรวมกันได้ 100% เฉพาะภายในมิติเดียวกัน (หมวดสินค้า, {region} หรือช่วงเวลา)
      </p>
      <TableView
        headers={["ส่วนที่เปลี่ยน", "มิติ", "ช่วงนี้", "ช่วงฐาน", "เปลี่ยนไป", "%", "สัดส่วนของการเปลี่ยนแปลง"]}
        rows={drivers.segments.map((s) => [name(s), dim(s), money(s.current), money(s.baseline),
          money(s.change), pct(s.change_pct, "–"), s.share_of_total_change === null ? "–" : `${s.share_of_total_change}%`])}
      />
    </>
  );
}

/** Every chart gets a table view: values stay reachable without hover or color. */
export function TableView({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <details className="table-view">
      <summary>ดูเป็นตาราง</summary>
      <div className="table-scroll">
        <table className="dtable">
          <thead><tr>{headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
