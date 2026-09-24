// Shop data (005_shops.sql) as named facts for the assistant - same rules as lib/factset.ts:
// the AI sees placeholders with their values and may only write the placeholders.
import type { Fact, FactSet } from "./factset";
import type { DaySummary, Forecast, PeriodSummary, ShopTotals } from "./shop";
import { count, dateLong, dateWithDay, money, num1 } from "./format";
import { WEEKDAY_TH } from "./labels";

const TH = { up: "เพิ่มขึ้น", down: "ลดลง", flat: "ทรงตัว" };

function change(now: number, before: number | null | undefined): Record<string, string> {
  if (before === null || before === undefined || before === 0) return {};
  const pct = ((now - before) / before) * 100;
  return { dir: Math.abs(pct) < 0.05 ? TH.flat : pct > 0 ? TH.up : TH.down, pct: `${num1(Math.abs(pct))}%` };
}

function totals(id: string, about: string, t: ShopTotals, prev: ShopTotals | null, sym: string): Fact[] {
  const facts: Fact[] = [{
    id, about,
    values: {
      revenue: money(t.revenue, sym),
      ...(prev ? change(t.revenue, prev.revenue) : {}),
      ...(prev ? { revenue_before: money(prev.revenue, sym) } : {}),
      expenses: money(t.expenses, sym),
      net: money(t.net_cash, sym),
      days: `${count(t.days_recorded)} วัน`,
      ...(t.gross_profit !== null ? { profit: money(t.gross_profit, sym) } : {}),
      ...(t.gross_profit !== null && t.menus_without_cost > 0
        ? { profit_note: `คิดจาก ${num1(t.profit_coverage_pct ?? 0)}% ของยอดขาย เพราะยังไม่มีต้นทุน ${t.menus_without_cost} เมนู` } : {}),
      ...(t.money_in !== null ? { cash: money(t.cash ?? 0, sym), transfer: money(t.transfer ?? 0, sym), money_in: money(t.money_in, sym) } : {}),
      ...(t.money_gap !== null && Math.abs(t.money_gap) >= 1
        ? { gap: `${t.money_gap < 0 ? "เงินขาด" : "เงินเกิน"} ${money(Math.abs(t.money_gap), sym)}` } : {}),
    },
  }];
  return facts;
}

export function shopDayFacts(p: string, d: DaySummary, sym: string): FactSet {
  const facts = totals(`${p}_day`, `ตัวเลขของ${dateWithDay(d.date)} เทียบกับวันเดียวกันของสัปดาห์ก่อน`, d.today, d.same_day_last_week, sym);
  facts[0].values.date = dateWithDay(d.date);
  d.menus.filter((m) => m.quantity > 0).slice(0, 8).forEach((m, i) => facts.push({
    id: `${p}_m${i + 1}`, about: `เมนูที่ขายได้ในวันนั้น อันดับ ${i + 1} ตามยอดขาย`,
    values: {
      name: `“${m.name}”`, quantity: `${count(m.quantity)} ${m.unit}`, revenue: money(m.revenue, sym),
      ...(m.gross_profit !== null ? { profit: money(m.gross_profit, sym) } : {}),
    },
  }));
  return { lang: "th", facts };
}

export function shopPeriodFacts(p: string, s: PeriodSummary, sym: string): FactSet {
  const r = s.range;
  const facts = totals(`${p}_period`, `ภาพรวม ${dateLong(r.start)} ถึง ${dateLong(r.end)} เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน`,
    s.current, s.previous, sym);
  facts[0].values.range = `${dateLong(r.start)} – ${dateLong(r.end)}`;
  facts[0].values.compare = `ช่วง ${r.days} วันก่อนหน้า`;
  s.menus.filter((m) => m.quantity > 0).slice(0, 10).forEach((m, i) => facts.push({
    id: `${p}_m${i + 1}`, about: `เมนูอันดับ ${i + 1} ตามยอดขายในช่วงนี้ (margin = กำไรต่อยอดขายของเมนูนั้น)`,
    values: {
      name: `“${m.name}”`, quantity: `${count(m.quantity)} ${m.unit}`, revenue: money(m.revenue, sym),
      share: `${num1(m.share ?? 0)}%`,
      ...(m.gross_profit !== null ? { profit: money(m.gross_profit, sym) } : {}),
      ...(m.margin_pct !== null ? { margin: `${num1(m.margin_pct)}%` } : { margin_note: "ยังไม่มีต้นทุน" }),
      ...change(m.quantity, m.prev_quantity),
    },
  }));
  const days = [...s.weekday].sort((a, b) => b.avg_revenue - a.avg_revenue);
  if (days.length > 1) {
    facts.push({ id: `${p}_weekday`, about: "วันในสัปดาห์ที่ขายเฉลี่ยได้มากที่สุดและน้อยที่สุด", values: {
      best: `วัน${WEEKDAY_TH[days[0].dow]}`, best_revenue: money(days[0].avg_revenue, sym),
      worst: `วัน${WEEKDAY_TH[days[days.length - 1].dow]}`, worst_revenue: money(days[days.length - 1].avg_revenue, sym),
    } });
  }
  s.expenses_by_category.slice(0, 5).forEach((x, i) => facts.push({
    id: `${p}_x${i + 1}`, about: `หมวดรายจ่ายอันดับ ${i + 1}`, values: { name: `“${x.category}”`, amount: money(x.amount, sym) },
  }));
  return { lang: "th", facts };
}

export function shopForecastFacts(p: string, f: Forecast): FactSet {
  const facts: Fact[] = [{
    id: `${p}_fc`, about: "การคาดการณ์ ใช้วันเดียวกันในสัปดาห์ของ 4 สัปดาห์ล่าสุดที่ร้านเปิด",
    values: { date: dateWithDay(f.date), weeks: `${count(f.samples)} สัปดาห์` },
  }];
  f.items.slice(0, 10).forEach((x, i) => facts.push({
    id: `${p}_f${i + 1}`, about: `ควรเตรียมเมนูนี้ประมาณเท่าไหร่ (low–high = ช่วงที่เคยขายได้)`,
    values: { name: `“${x.name}”`, expected: `${count(x.expected)} ${x.unit}`, low: `${count(x.low)} ${x.unit}`, high: `${count(x.high)} ${x.unit}` },
  }));
  return { lang: "th", facts };
}
