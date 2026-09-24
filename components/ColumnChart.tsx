"use client";
import { useRef, useState } from "react";
import type { BreakdownRow } from "@/lib/types";
import { count, money, moneyCompact } from "@/lib/format";
import { niceTicks, roundedTopBar } from "@/lib/chart";
import { useWidth } from "./useWidth";

const H = 210;
const M = { t: 10, r: 8, b: 26, l: 54 };

export type ColumnRow = BreakdownRow & { short: string };

/** Vertical columns for ordered buckets (hour of day, weekday). The peak column is labelled. */
export default function ColumnChart({ rows, labelEvery = 1, name, sym, showOrders = true }: {
  rows: ColumnRow[]; labelEvery?: number; name: string; sym: string; showOrders?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 520);
  const [hover, setHover] = useState<number | null>(null);

  const w = width - M.l - M.r;
  const h = H - M.t - M.b;
  const ticks = niceTicks(Math.max(1, ...rows.map((r) => r.revenue)), 3);
  const yMax = ticks[ticks.length - 1];
  const slot = w / Math.max(1, rows.length);
  const gap = Math.min(4, slot * 0.25);
  const y = (v: number) => M.t + h - (v / yMax) * h;
  const hr = hover === null ? null : rows[hover];
  const peak = rows.reduce((best, r, i) => (r.revenue > (rows[best]?.revenue ?? -1) ? i : best), 0);

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg width={width} height={H} role="img" aria-label={`รายได้ตาม${name}`}>
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={M.l} x2={M.l + w} y1={y(t)} y2={y(t)} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{moneyCompact(t, sym)}</text>
            </g>
          ))}
          {rows.map((r, i) =>
            i % labelEvery === 0 ? (
              <text key={r.key} x={M.l + slot * i + slot / 2} y={H - 6} textAnchor="middle">{r.short}</text>
            ) : null,
          )}
        </g>
        {rows.map((r, i) => {
          const bx = M.l + slot * i + gap / 2;
          const bw = slot - gap;
          return (
            <g key={r.key}>
              <path
                d={roundedTopBar(bx, y(r.revenue), bw, M.t + h - y(r.revenue))}
                fill="var(--series-1)"
                opacity={hover === null ? (i === peak ? 1 : 0.72) : hover === i ? 1 : 0.45}
              />
              {/* hit target: the whole column, bigger than the bar */}
              <rect
                x={M.l + slot * i} y={M.t} width={slot} height={h} fill="transparent"
                tabIndex={0}
                aria-label={`${r.label}: ${money(r.revenue, sym)}${showOrders ? `, ${count(r.orders)} คำสั่งซื้อ` : ""}`}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hr && hover !== null && (
        <div
          className="tooltip"
          style={{ left: Math.min(Math.max(M.l + slot * hover + slot / 2, 80), width - 80), top: 0 }}
          role="status"
        >
          <div className="muted">{hr.label}</div>
          <div className="t-row"><span>รายได้</span><strong className="tabular">{money(hr.revenue, sym)}</strong></div>
          {showOrders && <div className="t-row"><span>คำสั่งซื้อ</span><strong className="tabular">{count(hr.orders)}</strong></div>}
          <div className="t-row"><span>สัดส่วน</span><strong className="tabular">{hr.share ?? 0}%</strong></div>
        </div>
      )}
    </div>
  );
}
