// Turns SQL results into (1) a list of plain-text facts for the AI and
// (2) a rule-based summary used when the AI is off, fails, or invents numbers.
// Facts are written in the summary's language, so the AI copies Thai names and
// Thai (พ.ศ.) dates as they are instead of translating - and every number it
// writes can still be found in the facts.
import type { DailyReport, DashboardData, DriverSegment, Drivers, Lang } from "./types";
import { count, countOr, currencySymbol, dateLong, dateWithDay, money, money2, money2Or, num1, pct, pts, CURRENCY_NAME_TH } from "./format";
import { categoryLabel, dimensionLabel, segmentLabel, WEEKDAY_TH } from "./labels";

export type FactContext = { currency?: string; region?: string; hasTime?: boolean };

const absPct = (n: number | null, lang: Lang) => (n === null ? (lang === "th" ? "ไม่มีข้อมูล" : "n/a") : `${num1(Math.abs(n))}%`);
const na = (lang: Lang) => (lang === "th" ? "ไม่มีข้อมูล" : "n/a");

function currencyLine(lang: Lang, ctx: FactContext): string {
  const code = ctx.currency ?? "BRL";
  const sym = currencySymbol(code);
  return lang === "th"
    ? `สกุลเงิน: ${CURRENCY_NAME_TH[code] ?? code} (${sym}) รายได้ = ยอดขายสินค้า ไม่รวมค่าส่ง และไม่รวมคำสั่งซื้อที่ถูกยกเลิก`
    : `Currency: ${code} (${sym}). Revenue = product sales, excluding freight and canceled orders.`;
}

const seg = (s: DriverSegment, lang: Lang) => segmentLabel(s.dimension, s.segment, lang);

function driverFacts(d: Drivers, baselineName: string, lang: Lang, ctx: FactContext): string[] {
  const dim = (s: DriverSegment) => dimensionLabel(s.dimension, lang, ctx.region);
  if (lang === "th") {
    return [
      `รายได้เปลี่ยนไปเทียบกับ${baselineName}: ${money(d.total_change)} (${pct(d.total_change_pct, na(lang))})`,
      "ส่วนที่เปลี่ยนมากที่สุด (สัดส่วน = ส่วนนี้อธิบายการเปลี่ยนแปลงทั้งหมดได้กี่ % " +
        "สัดส่วนรวมกันได้ 100% เฉพาะภายในมิติเดียวกัน ห้ามนำสัดส่วนต่างมิติมารวมกัน):",
      ...d.segments.map((s) =>
        `- ${dim(s)} "${seg(s, lang)}": ${money(s.current)} เทียบกับ ${money(s.baseline)} ` +
        `(${s.change < 0 ? "ลดลง" : "เพิ่มขึ้น"} ${money(Math.abs(s.change))}, ${pct(s.change_pct, na(lang))}` +
        (s.share_of_total_change === null ? ")" : `, คิดเป็น ${num1(s.share_of_total_change)}% ของการเปลี่ยนแปลงทั้งหมด)`),
      ),
    ];
  }
  return [
    `Total revenue change vs ${baselineName}: ${money(d.total_change)} (${pct(d.total_change_pct)})`,
    "Segments that changed the most (share = part of the total change explained by that segment; " +
      "shares add up to 100% within one dimension only - never add shares across dimensions):",
    ...d.segments.map((s) =>
      `- ${dim(s)} "${seg(s, lang)}": ${money(s.current)} vs ${money(s.baseline)} ` +
      `(${s.change < 0 ? "down" : "up"} ${money(Math.abs(s.change))}, ${pct(s.change_pct)}` +
      (s.share_of_total_change === null ? ")" : `, share of total change ${num1(s.share_of_total_change)}%)`),
    ),
  ];
}

// ---------------------------------------------------------------- dashboard range

export function rangeFacts(d: DashboardData, lang: Lang, ctx: FactContext = {}): string[] {
  const { current: c, previous: p, growth_pct: g } = d.kpis;
  const r = d.range;
  const peakHour = [...d.by_hour].sort((a, b) => b.revenue - a.revenue)[0];
  const weekdays = [...d.by_weekday].sort((a, b) => b.revenue - a.revenue);
  const wd = (x?: { key: string; label: string }) => (x ? (lang === "th" ? `วัน${WEEKDAY_TH[Number(x.key)]}` : x.label) : na(lang));
  const topCats = d.by_category.filter((x) => x.key !== "Other").slice(0, 5);
  const topProducts = d.rank_product?.top ?? [];

  if (lang === "th") {
    return [
      currencyLine(lang, ctx),
      `ช่วงที่วิเคราะห์: ${dateLong(r.start)} ถึง ${dateLong(r.end)} (${r.days} วัน)`,
      `ช่วงที่ใช้เปรียบเทียบ: ${dateLong(r.prev_start)} ถึง ${dateLong(r.prev_end)} (${r.days} วันก่อนหน้า)`,
      `รายได้: ${money(c.revenue)} เทียบกับ ${money(p.revenue)} (${pct(g.revenue, na(lang))})`,
      ...(c.orders === null || c.aov === null ? [] : [
        `จำนวนคำสั่งซื้อ: ${count(c.orders)} เทียบกับ ${countOr(p.orders)} (${pct(g.orders, na(lang))})`,
        `ยอดเฉลี่ยต่อคำสั่งซื้อ: ${money2(c.aov)} เทียบกับ ${money2Or(p.aov)} (${pct(g.aov, na(lang))})`]),
      ...(c.customers === null ? [] : [
        `จำนวนลูกค้า (ไม่ซ้ำ): ${count(c.customers)} เทียบกับ ${countOr(p.customers)} (${pct(g.customers, na(lang))})`]),
      ...(c.on_time_rate === null ? [] : [
        `ส่งของตรงเวลา: ${c.on_time_rate}% เทียบกับ ${p.on_time_rate ?? na(lang)}% (${pts(d.kpis.on_time_change_pts, "th")})`]),
      `หมวดสินค้าที่ทำรายได้สูงสุด: ` +
        topCats.map((x) => `${categoryLabel(x.key, lang)} ${money(x.revenue)} (${x.share}% ของรายได้)`).join("; "),
      ...(topProducts.length ? [`สินค้าขายดี: ` +
        topProducts.map((x) => `${x.label} ${money(x.revenue)} (${x.share}%)`).join("; ")] : []),
      `ชั่วโมงที่ขายได้มากที่สุด: ${peakHour?.label} น. (${money(peakHour?.revenue ?? 0)})`,
      `วันที่ขายดีที่สุด: ${wd(weekdays[0])}; วันที่ขายได้น้อยที่สุด: ${wd(weekdays[weekdays.length - 1])}`,
      ...driverFacts(d.drivers, "ช่วงก่อนหน้า", lang, ctx),
    ];
  }
  return [
    currencyLine(lang, ctx),
    `Current period: ${dateLong(r.start, "en")} to ${dateLong(r.end, "en")} (${r.days} days)`,
    `Comparison period: ${dateLong(r.prev_start, "en")} to ${dateLong(r.prev_end, "en")} (the ${r.days} days before)`,
    `Revenue: ${money(c.revenue)} vs ${money(p.revenue)} (${pct(g.revenue)})`,
    ...(c.orders === null || c.aov === null ? [] : [
      `Orders: ${count(c.orders)} vs ${countOr(p.orders, "n/a")} (${pct(g.orders)})`,
      `Average order value: ${money2(c.aov)} vs ${money2Or(p.aov, "n/a")} (${pct(g.aov)})`]),
    ...(c.customers === null ? [] : [
      `Unique customers: ${count(c.customers)} vs ${countOr(p.customers, "n/a")} (${pct(g.customers)})`]),
    ...(c.on_time_rate === null ? [] : [
      `On-time delivery rate: ${c.on_time_rate}% vs ${p.on_time_rate ?? "n/a"}% (${pts(d.kpis.on_time_change_pts)})`]),
    `Top categories by revenue: ` +
      topCats.map((x) => `${categoryLabel(x.key, lang)} ${money(x.revenue)} (${x.share}% of revenue)`).join("; "),
    ...(topProducts.length ? [`Best-selling products: ` +
      topProducts.map((x) => `${x.label} ${money(x.revenue)} (${x.share}%)`).join("; ")] : []),
    `Busiest hour: ${peakHour?.label} (${money(peakHour?.revenue ?? 0)})`,
    `Strongest weekday: ${wd(weekdays[0])}; weakest weekday: ${wd(weekdays[weekdays.length - 1])}`,
    ...driverFacts(d.drivers, "the comparison period", lang, ctx),
  ];
}

function mainDrivers(d: Drivers) {
  const falling = d.total_change < 0;
  const same = d.segments.filter((s) => (falling ? s.change < 0 : s.change > 0));
  const opposite = d.segments.filter((s) => (falling ? s.change > 0 : s.change < 0));
  // one per dimension first, so we don't list SP / "Afternoon" / "Morning" all as the "cause"
  const seen = new Set<string>();
  const top = same.filter((s) => !seen.has(s.dimension) && seen.add(s.dimension)).slice(0, 2);
  return { falling, top, offset: opposite[0] };
}

function driverSentence(s: DriverSegment, lang: Lang, baseline: string, ctx: FactContext): string {
  const share = s.share_of_total_change;
  const dim = dimensionLabel(s.dimension, lang, ctx.region);
  if (lang === "th") {
    return `${dim} "${seg(s, lang)}" ${s.change < 0 ? "ลดลง" : "เพิ่มขึ้น"} ${money(Math.abs(s.change))} ` +
      `(${absPct(s.change_pct, lang)}) เมื่อเทียบกับ${baseline}` +
      (share !== null && share > 0 ? ` คิดเป็น ${num1(share)}% ของการเปลี่ยนแปลงทั้งหมด` : "");
  }
  return `${dim.charAt(0).toUpperCase() + dim.slice(1)} "${seg(s, lang)}" ${s.change < 0 ? "fell" : "grew"} ${money(Math.abs(s.change))} ` +
    `(${absPct(s.change_pct, lang)}) vs ${baseline}` +
    (share !== null && share > 0 ? `, ${num1(share)}% of the total change` : "");
}

export function rangeTemplate(d: DashboardData, lang: Lang, ctx: FactContext = {}) {
  const { current: c, growth_pct: g } = d.kpis;
  const days = d.range.days;
  const { falling, top, offset } = mainDrivers(d.drivers);
  const bTh = `ช่วง ${days} วันก่อนหน้า`, bEn = `the previous ${days} days`;

  if (lang === "th") {
    const bullets = [
      ...(c.orders === null || c.aov === null ? [] : [
        `มีคำสั่งซื้อ ${count(c.orders)} รายการ (${pct(g.orders, na(lang))}) ยอดเฉลี่ยต่อคำสั่งซื้อ ${money2(c.aov)} (${pct(g.aov, na(lang))})`]),
      ...top.map((s) => driverSentence(s, "th", bTh, ctx)),
      ...(offset ? [`ส่วนที่ช่วยชดเชย: ${driverSentence(offset, "th", bTh, ctx)}`] : []),
      ...(c.on_time_rate === null ? [] : [`ส่งของตรงเวลา ${c.on_time_rate}% (${pts(d.kpis.on_time_change_pts, "th")})`]),
    ];
    return {
      headline: g.revenue === null
        ? `รายได้ ${money(c.revenue)} ในช่วง ${days} วัน (ไม่มีข้อมูลช่วงก่อนหน้าให้เปรียบเทียบ)`
        : `รายได้${falling ? "ลดลง" : "เพิ่มขึ้น"} ${absPct(g.revenue, lang)} เป็น ${money(c.revenue)} เมื่อเทียบกับ${bTh}`,
      bullets,
      recommendation: top[0]
        ? `ควรเริ่มตรวจสอบที่${dimensionLabel(top[0].dimension, "th", ctx.region)} "${seg(top[0], lang)}" ก่อน เพราะเป็นส่วนที่ทำให้รายได้${falling ? "ลดลง" : "เพิ่มขึ้น"}มากที่สุด`
        : "ยอดขายค่อนข้างคงที่ ยังไม่มีส่วนใดที่ต้องตรวจสอบเป็นพิเศษ",
    };
  }
  const bullets = [
    ...(c.orders === null || c.aov === null ? [] : [
      `Orders: ${count(c.orders)} (${pct(g.orders)}); average order value ${money2(c.aov)} (${pct(g.aov)}).`]),
    ...top.map((s) => driverSentence(s, "en", bEn, ctx) + "."),
    ...(offset ? [`Partly offset by: ${driverSentence(offset, "en", bEn, ctx)}.`] : []),
    ...(c.on_time_rate === null ? [] : [`On-time delivery: ${c.on_time_rate}% (${pts(d.kpis.on_time_change_pts)}).`]),
  ];
  return {
    headline: g.revenue === null
      ? `Revenue was ${money(c.revenue)} over ${days} days (no earlier period to compare).`
      : `Revenue ${falling ? "fell" : "grew"} ${absPct(g.revenue, lang)} to ${money(c.revenue)} vs ${bEn}.`,
    bullets,
    recommendation: top[0]
      ? `Start with ${dimensionLabel(top[0].dimension, "en", ctx.region)} "${seg(top[0], lang)}" - it moved revenue the most.`
      : "Sales were stable; nothing stands out for follow-up.",
  };
}

// ---------------------------------------------------------------- daily report

export function dailyFacts(r: DailyReport, lang: Lang, ctx: FactContext = {}): string[] {
  const t = r.today, b = r.baseline_7d_avg, ch = r.change_pct, m = r.month_to_date;
  const cats = r.top_categories.filter((x) => x.key !== "Other");
  if (lang === "th") {
    return [
      currencyLine(lang, ctx),
      `วันที่ของรายงาน: ${dateWithDay(r.date)}`,
      `รายได้: ${money(t.revenue)} เทียบกับค่าเฉลี่ยรายวันของ 7 วันก่อน ${money(b.revenue)} (${pct(ch.revenue_vs_7d_avg, na(lang))})`,
      `รายได้เมื่อเทียบกับวันก่อนหน้า: ${money(r.previous_day.revenue)} (${pct(ch.revenue_vs_prev_day, na(lang))})`,
      `รายได้เมื่อเทียบกับวันเดียวกันของสัปดาห์ก่อน: ${money(r.same_day_last_week.revenue)} (${pct(ch.revenue_vs_same_day_last_week, na(lang))})`,
      ...(t.orders === null || t.aov === null ? [] : [
        `จำนวนคำสั่งซื้อ: ${count(t.orders)} เทียบกับค่าเฉลี่ย 7 วัน ${b.orders === null ? na(lang) : num1(b.orders)} (${pct(ch.orders_vs_7d_avg, na(lang))})`,
        `ยอดเฉลี่ยต่อคำสั่งซื้อ: ${money2(t.aov)} เทียบกับ 7 วัน ${money2Or(b.aov)} (${pct(ch.aov_vs_7d_avg, na(lang))})`]),
      `ยอดสะสมเดือนนี้ (${dateLong(m.start)} ถึง ${dateLong(m.end)}): ${money(m.revenue)}${m.orders === null ? "" : `, ${count(m.orders)} คำสั่งซื้อ`}; ` +
        `ช่วงเดียวกันของเดือนก่อน ${money(m.prev_month_same_days_revenue)} (${pct(m.change_pct, na(lang))})`,
      `การแจ้งเตือน: ${r.anomaly === "drop" ? "รายได้ลดลงตั้งแต่ 25% ขึ้นไปเมื่อเทียบกับค่าเฉลี่ย 7 วัน"
        : r.anomaly === "spike" ? "รายได้เพิ่มขึ้นตั้งแต่ 25% ขึ้นไปเมื่อเทียบกับค่าเฉลี่ย 7 วัน" : "ไม่มี"}`,
      `หมวดสินค้าที่ขายดีวันนี้: ` + cats.map((x) => `${categoryLabel(x.key, lang)} ${money(x.revenue)} (${x.share}%)`).join("; "),
      ...driverFacts(r.drivers, "ค่าเฉลี่ยรายวันของ 7 วันก่อน", lang, ctx),
    ];
  }
  return [
    currencyLine(lang, ctx),
    `Report date: ${dateWithDay(r.date, "en")}`,
    `Revenue: ${money(t.revenue)} vs 7-day daily average ${money(b.revenue)} (${pct(ch.revenue_vs_7d_avg)})`,
    `Revenue vs previous day: ${money(r.previous_day.revenue)} (${pct(ch.revenue_vs_prev_day)})`,
    `Revenue vs same weekday last week: ${money(r.same_day_last_week.revenue)} (${pct(ch.revenue_vs_same_day_last_week)})`,
    ...(t.orders === null || t.aov === null ? [] : [
      `Orders: ${count(t.orders)} vs 7-day daily average ${b.orders === null ? "n/a" : num1(b.orders)} (${pct(ch.orders_vs_7d_avg)})`,
      `Average order value: ${money2(t.aov)} vs 7-day ${money2Or(b.aov, "n/a")} (${pct(ch.aov_vs_7d_avg)})`]),
    `Month to date (${dateLong(m.start, "en")} to ${dateLong(m.end, "en")}): ${money(m.revenue)}${m.orders === null ? "" : `, ${count(m.orders)} orders`}; ` +
      `same days last month ${money(m.prev_month_same_days_revenue)} (${pct(m.change_pct)})`,
    `Alert: ${r.anomaly === "drop" ? "revenue DROP of 25% or more vs the 7-day average"
      : r.anomaly === "spike" ? "revenue SPIKE of 25% or more vs the 7-day average" : "none"}`,
    `Top categories today: ` + cats.map((x) => `${categoryLabel(x.key, lang)} ${money(x.revenue)} (${x.share}%)`).join("; "),
    ...driverFacts(r.drivers, "the 7-day daily average", lang, ctx),
  ];
}

export function dailyTemplate(r: DailyReport, lang: Lang, ctx: FactContext = {}) {
  const t = r.today, ch = r.change_pct;
  const { falling, top } = mainDrivers(r.drivers);
  const chg = ch.revenue_vs_7d_avg;

  if (lang === "th") {
    return {
      headline: chg === null
        ? `${dateLong(r.date)}: รายได้ ${money(t.revenue)}`
        : `${dateLong(r.date)}: รายได้ ${money(t.revenue)} ${falling ? "ต่ำกว่า" : "สูงกว่า"}ค่าเฉลี่ย 7 วัน ${absPct(chg, lang)}`,
      bullets: [
        ...(t.orders === null || t.aov === null ? [] : [
          `มีคำสั่งซื้อ ${count(t.orders)} รายการ (${pct(ch.orders_vs_7d_avg, na(lang))}) ยอดเฉลี่ย ${money2(t.aov)} ต่อคำสั่งซื้อ (${pct(ch.aov_vs_7d_avg, na(lang))})`]),
        ...top.map((s) => driverSentence(s, "th", "ค่าเฉลี่ย 7 วัน", ctx)),
        `ยอดสะสมเดือนนี้ ${money(r.month_to_date.revenue)} (${pct(r.month_to_date.change_pct, na(lang))} เมื่อเทียบกับช่วงเดียวกันของเดือนก่อน)`,
      ],
      recommendation: r.anomaly
        ? `ยอดขาย${r.anomaly === "drop" ? "ลดลง" : "เพิ่มขึ้น"}ผิดปกติ ควรตรวจสอบ${top[0] ? `${dimensionLabel(top[0].dimension, "th", ctx.region)} "${seg(top[0], lang)}" ` : "ข้อมูล"}ของวันนี้ก่อน`
        : "ยอดขายอยู่ในเกณฑ์ปกติ",
    };
  }
  return {
    headline: chg === null
      ? `${dateLong(r.date, "en")}: revenue ${money(t.revenue)}`
      : `${dateLong(r.date, "en")}: revenue ${money(t.revenue)}, ${absPct(chg, lang)} ${falling ? "below" : "above"} the 7-day average`,
    bullets: [
      ...(t.orders === null || t.aov === null ? [] : [
        `Orders: ${count(t.orders)} (${pct(ch.orders_vs_7d_avg)}); average order value ${money2(t.aov)} (${pct(ch.aov_vs_7d_avg)}).`]),
      ...top.map((s) => driverSentence(s, "en", "the 7-day average", ctx) + "."),
      `Month to date: ${money(r.month_to_date.revenue)} (${pct(r.month_to_date.change_pct)} vs the same days last month).`,
    ],
    recommendation: r.anomaly
      ? `Unusual ${r.anomaly}: check ${top[0] ? `${dimensionLabel(top[0].dimension, "en", ctx.region)} "${seg(top[0], lang)}"` : "today's data"} first.`
      : "Sales are within the normal range.",
  };
}
