import type { Metadata } from "next";
import { currentShop } from "@/lib/current";
import { addDays, count, currencySymbol, dateLong, money, pct } from "@/lib/format";
import { WEEKDAY_TH } from "@/lib/labels";
import { periodSummary, todayBangkok } from "@/lib/shop";
import { supabaseConfigured } from "@/lib/supabase";
import { hasData, loadBounds } from "@/lib/data";
import { Card, DeltaPill } from "@/components/Blocks";
import { SetupNotice } from "@/components/Notice";
import ShopSwitcher from "@/components/shop/ShopSwitcher";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "รายงาน" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const RANGES = [{ id: "7", label: "7 วัน" }, { id: "28", label: "4 สัปดาห์" }, { id: "90", label: "3 เดือน" }];
const growth = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const { shops, shop } = await currentShop();
  if (!shop) return <div className="card notice"><p style={{ margin: 0 }}>ยังไม่มีร้าน <a href="/">สร้างร้านที่หน้าหลัก</a></p></div>;

  const days = Number(RANGES.find((r) => r.id === sp.range)?.id ?? 28);
  const today = todayBangkok();
  const [p, imported] = await Promise.all([
    periodSummary(shop.id, addDays(today, -(days - 1)), today),
    loadBounds().then(hasData).catch(() => false),
  ]);
  const sym = currencySymbol(shop.currency);
  const c = p.current, prev = p.previous;
  const sold = p.menus.filter((m) => m.quantity > 0);
  const weekdayMax = Math.max(1, ...p.weekday.map((w) => w.avg_revenue));
  const expMax = Math.max(1, ...p.expenses_by_category.map((x) => x.amount));

  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>รายงาน</h1>
          <p className="muted">{shop.name} · {dateLong(p.range.start)} – {dateLong(p.range.end)}</p>
        </div>
        <div className="controls">
          <nav className="seg" aria-label="ช่วงเวลา">
            {RANGES.map((r) => <a key={r.id} href={`/reports?range=${r.id}`} aria-current={Number(r.id) === days ? "true" : undefined}>{r.label}</a>)}
          </nav>
          <ShopSwitcher shops={shops} current={shop.id} next="/reports" />
        </div>
      </div>

      <div className="grid kpis">
        <div className="card kpi"><div className="kpi-label">ยอดขาย</div><div className="kpi-value tabular">{money(c.revenue, sym)}</div>
          <div className="kpi-foot"><DeltaPill value={growth(c.revenue, prev.revenue)} /> <span>เทียบกับช่วงก่อน</span></div></div>
        <div className="card kpi"><div className="kpi-label">กำไรโดยประมาณ</div>
          <div className="kpi-value tabular">{c.gross_profit === null ? "–" : money(c.gross_profit, sym)}</div>
          <div className="kpi-foot"><span>{c.menus_without_cost > 0 ? `ยังไม่มีต้นทุน ${c.menus_without_cost} เมนู` : "ยอดขาย − ต้นทุนต่อเมนู"}</span></div></div>
        <div className="card kpi"><div className="kpi-label">รายจ่ายที่จด</div><div className="kpi-value tabular">{money(c.expenses, sym)}</div>
          <div className="kpi-foot"><span>เงินสุทธิ {money(c.net_cash, sym)}</span></div></div>
        <div className="card kpi"><div className="kpi-label">เปิดร้าน</div><div className="kpi-value tabular">{count(c.days_recorded)} วัน</div>
          <div className="kpi-foot">{c.money_gap !== null && c.money_gap <= -1 ? <span className="error">เงินขาดรวม {money(-c.money_gap, sym)}</span> : <span>เงินไม่ขาด</span>}</div></div>
      </div>

      <div className="grid two">
        <Card title="เมนูไหนทำเงิน" sub="เรียงตามยอดขาย · อัตรากำไร = (ยอดขาย − ต้นทุน) ÷ ยอดขาย">
          {sold.length === 0 ? <p className="muted">ยังไม่มียอดในช่วงนี้</p> : (
            <ul className="menu-rank">
              {sold.map((m, i) => (
                <li key={m.menu_item_id}>
                  <span className="rank-no">{i + 1}</span>
                  <span className="mr-name">{m.name}<small className="muted">{count(m.quantity)} {m.unit}
                    {m.quantity_change_pct !== null && <span className={m.quantity_change_pct < 0 ? "delta-down" : "delta-up"}> · {m.quantity_change_pct < 0 ? "▼" : "▲"} {pct(m.quantity_change_pct)}</span>}</small></span>
                  <span className="mr-val">{money(m.revenue, sym)}
                    <small className="muted">{m.margin_pct === null ? "ไม่มีต้นทุน" : `กำไร ${m.margin_pct}%`}</small></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="stack">
          <Card title="วันไหนขายดี" sub="ยอดขายเฉลี่ยต่อวัน">
            <div className="barlist">
              {p.weekday.map((w) => (
                <div className="bar-row" key={w.dow}>
                  <span className="bar-label">วัน{WEEKDAY_TH[w.dow]}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(w.avg_revenue / weekdayMax) * 100}%`, display: "block" }} /></span>
                  <span className="bar-value">{money(w.avg_revenue, sym)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="จ่ายไปกับอะไร">
            {p.expenses_by_category.length === 0 ? <p className="muted" style={{ margin: 0 }}>ยังไม่มีรายจ่ายที่จด</p> : (
              <div className="barlist">
                {p.expenses_by_category.map((x) => (
                  <div className="bar-row" key={x.category}>
                    <span className="bar-label">{x.category}</span>
                    <span className="bar-track"><span className="bar-fill other" style={{ width: `${(x.amount / expMax) * 100}%`, display: "block" }} /></span>
                    <span className="bar-value">{money(x.amount, sym)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {imported && (
        <a className="card link-card section-gap" href="/analytics">
          <strong>วิเคราะห์ไฟล์ยอดขายที่นำเข้า →</strong>
          <span className="muted">แนวโน้ม สาเหตุที่ยอดเปลี่ยน สินค้า ช่วงเวลา และสรุปด้วย AI</span>
        </a>
      )}
    </>
  );
}
