import type { BreakdownRow, DashboardData, LoadedBounds, Ranking } from "@/lib/types";
import type { ResolvedRange } from "@/lib/range";
import { count, countOr, currencySymbol, dateLong, money, money2Or, CURRENCY_NAME_TH } from "@/lib/format";
import { categoryLabel, regionLabel, WEEKDAY_TH, WEEKDAY_TH_SHORT } from "@/lib/labels";
import { BarList, Card, DriversChart, KpiTile, RankList, TableView } from "./Blocks";
import RangeControls from "./RangeControls";
import TrendChart from "./TrendChart";
import ColumnChart from "./ColumnChart";
import InsightsPanel from "./InsightsPanel";
import Tabs from "./Tabs";

const tableRows = (rows: BreakdownRow[], showOrders = true) =>
  rows.map((x) => [x.label, money(x.revenue), showOrders ? count(x.orders) : "–", `${x.share ?? 0}%`]);

function RankingCard({ ranking, isProduct, showOrders }: { ranking: Ranking; isProduct: boolean; showOrders: boolean }) {
  const label = (key: string) => (isProduct ? key : categoryLabel(key));
  const relabel = (rows: Ranking["top"]) => rows.map((r) => ({ ...r, label: label(r.key) }));
  const top = relabel(ranking.top);
  // with few items the two lists overlap - only show what isn't already in the top list
  const topKeys = new Set(top.map((r) => r.key));
  const bottom = relabel(ranking.bottom).filter((r) => !topKeys.has(r.key));
  const noun = isProduct ? "สินค้า" : "หมวดสินค้า";
  return (
    <Card
      title={isProduct ? "สินค้าขายดีและขายน้อย" : "หมวดสินค้าขายดีและขายน้อย"}
      sub={`จัดอันดับจากรายได้ในช่วงนี้ · มี${noun}ที่ขายได้ ${count(ranking.items)} รายการ`}
    >
      <Tabs
        label={`อันดับ${noun}`}
        tabs={[
          { id: "top", label: "▲ ขายดี 5 อันดับ", content: <div className="rank-top"><RankList rows={top} empty="ไม่มียอดขายในช่วงนี้" showOrders={showOrders} /></div> },
          { id: "bottom", label: "▼ ขายน้อย 5 อันดับ", content: <RankList rows={bottom} empty={`มี${noun}น้อยเกินกว่าจะแยกกลุ่มขายน้อยได้`} showOrders={showOrders} /> },
        ]}
      />
      <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
        % ใต้ยอดเงิน = การเปลี่ยนแปลงเมื่อเทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน
      </p>
    </Card>
  );
}

export default function Dashboard({ data, bounds, range }: { data: DashboardData; bounds: LoadedBounds; range: ResolvedRange }) {
  const { current: c, growth_pct: g } = data.kpis;
  const r = data.range;
  const vs = `เทียบกับ ${r.days} วันก่อนหน้า`;
  const sym = currencySymbol(bounds.currency);
  const region = bounds.region_label ?? "รัฐของลูกค้า";
  const isOlist = (bounds.currency ?? "BRL") === "BRL";
  const hasOrders = bounds.has_order_ids !== false;
  const noBills = "ไฟล์ที่นำเข้าไม่มีเลขบิล จึงนับจำนวนบิลไม่ได้";

  const byCategory = data.by_category.map((x) => ({ ...x, label: categoryLabel(x.key) }));
  const byRegion = data.by_state.map((x) => ({ ...x, label: regionLabel(x.key) }));
  const byHour = data.by_hour.map((x) => ({ ...x, label: `${x.label} น.`, short: x.key.padStart(2, "0") }));
  const byWeekday = data.by_weekday.map((x) => ({
    ...x, label: `วัน${WEEKDAY_TH[Number(x.key)]}`, short: WEEKDAY_TH_SHORT[Number(x.key)],
  }));
  const trendRev = data.trend.map((p) => p.revenue_ma7);
  const trendOrd = data.trend.map((p) => p.orders);
  const ranking = data.rank_product ?? data.rank_category;
  const peakHour = [...data.by_hour].sort((a, b) => b.revenue - a.revenue)[0];
  const exportHref = `/api/export?start=${r.start}&end=${r.end}`;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            ข้อมูล: {bounds.dataset_name ?? "Olist (บราซิล)"} · สกุลเงิน {CURRENCY_NAME_TH[bounds.currency ?? "BRL"] ?? bounds.currency} ({sym})
          </span>
          <h1>ภาพรวมยอดขาย</h1>
          <p>
            {dateLong(r.start)} – {dateLong(r.end)} ({r.days} วัน){" "}
            <span className="muted">
              · ข้อมูลล่าสุดถึง {dateLong(range.anchor)}
              {bounds.sim_date ? " (วันที่จำลองเป็น “วันนี้”)" : ""}
            </span>
          </p>
        </div>
        <RangeControls preset={range.preset} start={r.start} end={r.end} min={bounds.min_date} max={bounds.max_date} />
      </div>

      {!data.rank_category && (
        <div className="alert alert-warn" role="status">
          <span aria-hidden="true">⚠️</span>
          <div>
            <strong>ยังไม่ได้รัน migration 003</strong>
            <p>บางส่วน (อันดับสินค้าขายดี/ขายน้อย, การนำเข้าไฟล์) จะยังไม่แสดง รัน <code>python pipeline/migrate.py</code> แล้วรีเฟรชหน้านี้</p>
          </div>
        </div>
      )}

      <div className="grid kpis">
        <KpiTile icon="revenue" label="รายได้" value={money(c.revenue)} delta={g.revenue} suffix={vs} spark={trendRev} />
        <KpiTile icon="orders" label="คำสั่งซื้อ" value={countOr(c.orders)} delta={g.orders} suffix={vs} spark={trendOrd}
          missing={c.orders === null ? noBills : undefined} />
        <KpiTile icon="aov" label="ยอดเฉลี่ยต่อคำสั่งซื้อ" value={money2Or(c.aov)} delta={g.aov} suffix={vs}
          missing={c.aov === null ? noBills : undefined} />
        <KpiTile icon="customers" label="ลูกค้า (ไม่นับซ้ำ)" value={countOr(c.customers)} delta={g.customers} suffix={vs}
          missing={c.customers === null ? "ไฟล์ที่นำเข้าไม่มีรหัสลูกค้า จึงนับจำนวนลูกค้าไม่ได้" : undefined} />
        {c.on_time_rate !== null && (
          <KpiTile icon="delivery" label="ส่งของตรงเวลา" value={`${c.on_time_rate}%`} delta={data.kpis.on_time_change_pts} suffix={vs} unit="pts" />
        )}
      </div>

      {/* key forces a fresh panel (no stale summary) when the date range changes */}
      <InsightsPanel key={`${r.start}:${r.end}`} start={r.start} end={r.end} />

      <div className="section-gap">
        <Card
          title="แนวโน้มรายได้"
          sub={`รายได้จากสินค้าต่อวัน (ไม่รวมค่าส่งและคำสั่งซื้อที่ยกเลิก) · ${r.days} วัน`}
          action={<a className="btn btn-sm" href={exportHref} download>⬇ ดาวน์โหลด CSV (เปิดใน Excel ได้)</a>}
        >
          <TrendChart points={data.trend} sym={sym} showOrders={hasOrders} />
          <TableView
            headers={["วันที่", "รายได้", "ค่าเฉลี่ย 7 วัน", "คำสั่งซื้อ"]}
            rows={data.trend.map((p) => [dateLong(p.date), money(p.revenue), money(p.revenue_ma7), hasOrders ? count(p.orders) : "–"])}
          />
        </Card>
      </div>

      <div className="grid two">
        <Card title="อะไรทำให้รายได้เปลี่ยน" sub={`เทียบกับช่วงฐาน ${dateLong(r.prev_start)} – ${dateLong(r.prev_end)}`}>
          <DriversChart
            drivers={bounds.has_time === false
              ? { ...data.drivers, segments: data.drivers.segments.filter((s) => s.dimension !== "time_of_day") }
              : data.drivers}
            baselineLabel={`ช่วง ${r.days} วันก่อนหน้า`} region={region} />
        </Card>

        {ranking ? (
          <RankingCard ranking={ranking} isProduct={Boolean(data.rank_product)} showOrders={hasOrders} />
        ) : (
          <Card title="ลูกค้า" sub="ลูกค้าที่ไม่นับซ้ำในช่วงนี้">
            <div className="kpi-value tabular">{countOr(c.customers)}</div>
            <p className="muted" style={{ margin: 0 }}>ซื้อสินค้า {countOr(c.items)} ชิ้น ใน {countOr(c.orders)} คำสั่งซื้อ</p>
          </Card>
        )}

        <Card title="รายได้ตามหมวดสินค้า" sub="10 อันดับแรก ที่เหลือรวมเป็น “อื่น ๆ”">
          <BarList rows={byCategory} showOrders={hasOrders} />
          <TableView headers={["หมวดสินค้า", "รายได้", "คำสั่งซื้อ", "สัดส่วน"]} rows={tableRows(byCategory, hasOrders)} />
        </Card>

        <Card title={`รายได้ตาม${region}`} sub={isOlist ? "รัฐในบราซิลที่ลูกค้าอยู่" : "8 อันดับแรก ที่เหลือรวมเป็น “อื่น ๆ”"}>
          <BarList rows={byRegion} showOrders={hasOrders} />
          <TableView headers={[region, "รายได้", "คำสั่งซื้อ", "สัดส่วน"]} rows={tableRows(byRegion, hasOrders)} />
        </Card>

        <Card
          title="รายได้ตามช่วงเวลาของวัน"
          sub={bounds.has_time === false
            ? "ไฟล์ที่นำเข้าไม่มีเวลา (มีแต่วันที่) ทุกรายการจึงอยู่ที่ 00 น."
            : `ขายดีที่สุดช่วง ${peakHour?.label ?? "-"} น.${isOlist ? " (เวลาในบราซิล)" : ""}`}
        >
          <ColumnChart showOrders={hasOrders} rows={byHour} labelEvery={3} name="ชั่วโมง" sym={sym} />
          <TableView headers={["ชั่วโมง", "รายได้", "คำสั่งซื้อ", "สัดส่วน"]} rows={tableRows(byHour, hasOrders)} />
        </Card>

        <Card title="รายได้ตามวันในสัปดาห์">
          <ColumnChart showOrders={hasOrders} rows={byWeekday} name="วันในสัปดาห์" sym={sym} />
          <TableView headers={["วัน", "รายได้", "คำสั่งซื้อ", "สัดส่วน"]} rows={tableRows(byWeekday, hasOrders)} />
        </Card>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 20 }}>
        ตัวเลขทุกตัวคำนวณด้วย SQL ในฐานข้อมูล · % การเปลี่ยนแปลงทุกช่องเทียบกับช่วง {dateLong(r.prev_start)} – {dateLong(r.prev_end)}
      </p>
    </>
  );
}
