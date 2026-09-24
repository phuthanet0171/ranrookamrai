// GET /api/export?start=2018-04-15&end=2018-05-14
// CSV for Excel / Google Sheets: daily totals, then every breakdown of the period.
// UTF-8 with BOM so Excel shows Thai correctly when the file is double-clicked.
import type { DashboardData } from "@/lib/types";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { daysBetween, isIsoDate } from "@/lib/format";
import { loadBounds } from "@/lib/data";
import { categoryLabel, regionLabel, WEEKDAY_TH } from "@/lib/labels";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: unknown[]) => cells.map(cell).join(",");

export async function GET(req: Request) {
  if (!supabaseConfigured()) return new Response("ยังไม่ได้ตั้งค่า Supabase", { status: 500 });
  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!isIsoDate(start) || !isIsoDate(end) || start > end || daysBetween(start, end) > 800) {
    return new Response("start/end ไม่ถูกต้อง (YYYY-MM-DD)", { status: 400 });
  }

  try {
    const bounds = await loadBounds();
    const d = await rpc<DashboardData>("dashboard_data", { p_start: start, p_end: end });
    const cur = bounds.currency ?? "BRL";
    const region = bounds.region_label ?? "รัฐของลูกค้า";
    const out: string[] = [];

    out.push(line([`รายงานยอดขาย ${start} ถึง ${end}`, `สกุลเงิน ${cur}`, bounds.dataset_name ?? ""]));
    out.push("");
    out.push(line(["สรุป", "ช่วงนี้", "ช่วงก่อนหน้า", "เปลี่ยนแปลง (%)"]));
    const k = d.kpis;
    out.push(line(["รายได้", k.current.revenue, k.previous.revenue, k.growth_pct.revenue]));
    out.push(line(["คำสั่งซื้อ", k.current.orders, k.previous.orders, k.growth_pct.orders]));
    out.push(line(["ยอดเฉลี่ยต่อคำสั่งซื้อ", k.current.aov, k.previous.aov, k.growth_pct.aov]));
    out.push(line(["ลูกค้า (ไม่นับซ้ำ)", k.current.customers, k.previous.customers, k.growth_pct.customers]));
    out.push("");

    out.push(line(["วันที่", "รายได้", "คำสั่งซื้อ", "ค่าเฉลี่ยรายได้ 7 วัน"]));
    for (const p of d.trend) out.push(line([p.date, p.revenue, p.orders, p.revenue_ma7]));
    out.push("");

    const block = (title: string, rows: { key: string; revenue: number; orders: number; share: number | null }[], label: (k: string) => string) => {
      out.push(line([title, "รายได้", "คำสั่งซื้อ", "สัดส่วน (%)"]));
      for (const r of rows) out.push(line([label(r.key), r.revenue, r.orders, r.share]));
      out.push("");
    };
    block("หมวดสินค้า", d.by_category, (x) => categoryLabel(x));
    block(region, d.by_state, (x) => regionLabel(x));
    block("ชั่วโมง", d.by_hour, (x) => `${x.padStart(2, "0")}:00`);
    block("วันในสัปดาห์", d.by_weekday, (x) => WEEKDAY_TH[Number(x)]);
    if (d.rank_product) block("สินค้าขายดี", d.rank_product.top, (x) => x);

    const body = "﻿" + out.join("\r\n");
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales_${start}_${end}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`ส่งออกไม่สำเร็จ: ${(e as Error).message}`, { status: 500 });
  }
}
