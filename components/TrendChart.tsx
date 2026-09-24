"use client";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TrendPoint } from "@/lib/types";
import { count, dateShort, dateWithDay, money, moneyCompact } from "@/lib/format";
import { niceTicks, tickIndices } from "@/lib/chart";
import { useWidth } from "./useWidth";

const H = 280;
const M = { t: 12, r: 12, b: 28, l: 60 };

export default function TrendChart({ points, sym, showOrders = true }: { points: TrendPoint[]; sym: string; showOrders?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap);
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  const w = width - M.l - M.r;
  const h = H - M.t - M.b;
  const max = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.revenue_ma7)));
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => M.l + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => M.t + h - (v / yMax) * h;
  const line = (key: "revenue" | "revenue_ma7") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const area = n > 1 ? `${line("revenue_ma7")}L${x(n - 1).toFixed(1)},${M.t + h}L${x(0).toFixed(1)},${M.t + h}Z` : "";

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - M.l) / w) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((v) => Math.min(n - 1, (v ?? -1) + 1));
    if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? n) - 1));
    if (e.key === "Escape") setHover(null);
  };

  const hp = hover === null ? null : points[hover];
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), 100), width - 100);

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><i className="swatch-line soft" /> รายได้รายวัน</span>
        <span><i className="swatch-line" /> ค่าเฉลี่ย 7 วัน</span>
      </div>
      <div className="chart-wrap" ref={wrap}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="กราฟรายได้รายวันและค่าเฉลี่ย 7 วัน กดลูกศรซ้าย/ขวาเพื่ออ่านค่าแต่ละวัน"
          tabIndex={0}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={M.l} x2={M.l + w} y1={y(t)} y2={y(t)} />
                <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{moneyCompact(t, sym)}</text>
              </g>
            ))}
            {n > 0 && tickIndices(n, Math.max(2, Math.floor(w / 90))).map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {dateShort(points[i].date)}
              </text>
            ))}
          </g>
          {area && <path d={area} fill="url(#trendFill)" />}
          <path d={line("revenue")} fill="none" stroke="var(--series-1-soft)" strokeWidth={1.5} strokeLinejoin="round" />
          <path d={line("revenue_ma7")} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {hp && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + h} stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(hp.revenue)} r={4} fill="var(--series-1-soft)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(hp.revenue_ma7)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div className="tooltip" style={{ left: tipLeft, top: 0 }} role="status">
            <div className="muted">{dateWithDay(hp.date)}</div>
            <div className="t-row"><span>รายได้</span><strong className="tabular">{money(hp.revenue, sym)}</strong></div>
            <div className="t-row"><span>ค่าเฉลี่ย 7 วัน</span><strong className="tabular">{money(hp.revenue_ma7, sym)}</strong></div>
            {showOrders && <div className="t-row"><span>คำสั่งซื้อ</span><strong className="tabular">{count(hp.orders)}</strong></div>}
          </div>
        )}
      </div>
    </div>
  );
}
