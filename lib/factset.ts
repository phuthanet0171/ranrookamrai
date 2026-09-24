// The AI never writes a number or a direction word itself.
//
// SQL results become a set of named facts, e.g. revenue.now = "฿ 1,009,935",
// revenue.dir = "เพิ่มขึ้น", revenue.pct = "4.4%". The AI writes sentences with
// placeholders ("รายได้{revenue.dir} {revenue.pct}") and the code fills them in.
// checkDraft() rejects any draft that still contains a digit, a direction word
// (เพิ่มขึ้น / ลดลง / grew / fell ...) or a placeholder that does not exist - so the
// AI can choose WHAT to say, but cannot get a value, a unit or a direction wrong.
// What it cannot check: whether the AI's interpretation is sensible. That stays a human job.
import type { DailyReport, DashboardData, DriverSegment, Lang } from "./types";
import { count, dateLong, dateWithDay, money, money2, num1 } from "./format";
import { categoryLabel, dimensionLabel, segmentLabel, WEEKDAY_TH } from "./labels";
import type { FactContext } from "./facts";

export type Fact = { id: string; about: string; values: Record<string, string> };
export type FactSet = { lang: Lang; facts: Fact[] };

const TH = {
  up: "เพิ่มขึ้น", down: "ลดลง", flat: "ทรงตัว",
  above: "สูงกว่า", below: "ต่ำกว่า", level: "ใกล้เคียงกับ",
};
const EN = { up: "rose", down: "fell", flat: "was flat", above: "above", below: "below", level: "in line with" };

/** Change of a value: direction words and an unsigned percentage, filled in by code. */
function change(lang: Lang, pct: number | null): Record<string, string> {
  if (pct === null) return {};
  const w = lang === "th" ? TH : EN;
  const flat = Math.abs(pct) < 0.05;
  return {
    dir: flat ? w.flat : pct > 0 ? w.up : w.down,
    cmp: flat ? w.level : pct > 0 ? w.above : w.below,
    pct: `${num1(Math.abs(pct))}%`,
  };
}

const unit = (lang: Lang, th: string, en: string) => (lang === "th" ? th : en);

function driverFacts(segs: DriverSegment[], lang: Lang, ctx: FactContext, baseline: string): Fact[] {
  // no clock times in the data -> every sale sits at 00:00, so "time of day" says nothing
  const usable = ctx.hasTime === false ? segs.filter((s) => s.dimension !== "time_of_day") : segs;
  return usable.slice(0, 6).map((s, i) => ({
    id: `d${i + 1}`,
    about: lang === "th"
      ? `ส่วนที่ทำให้รายได้เปลี่ยนมากเป็นอันดับ ${i + 1} (เทียบกับ${baseline}); share = สัดส่วนของการเปลี่ยนแปลงทั้งหมด (รวมกันได้ 100% เฉพาะในมิติเดียวกัน)`
      : `segment #${i + 1} that moved revenue (vs ${baseline}); share = part of the total change (adds up to 100% only within one dimension)`,
    values: {
      name: `${dimensionLabel(s.dimension, lang, ctx.region)} “${segmentLabel(s.dimension, s.segment, lang)}”`,
      now: money(s.current),
      baseline: money(s.baseline),
      amount: money(Math.abs(s.change)),
      ...change(lang, s.change_pct ?? (s.change === 0 ? 0 : null)),
      // direction of the amount even when the % is unknown (baseline 0)
      ...(s.change_pct === null && s.change !== 0 ? { dir: s.change > 0 ? (lang === "th" ? TH.up : EN.up) : (lang === "th" ? TH.down : EN.down) } : {}),
      ...(s.share_of_total_change !== null && s.share_of_total_change > 0 ? { share: `${num1(s.share_of_total_change)}%` } : {}),
    },
  }));
}

export function rangeFactSet(d: DashboardData, lang: Lang, ctx: FactContext = {}): FactSet {
  const { current: c, previous: p, growth_pct: g } = d.kpis;
  const r = d.range;
  const th = lang === "th";
  const baseline = th ? `ช่วง ${r.days} วันก่อนหน้า` : `the previous ${r.days} days`;
  const facts: Fact[] = [
    {
      id: "period",
      about: th ? "ช่วงเวลาที่วิเคราะห์และช่วงที่ใช้เทียบ" : "period analysed and the comparison period",
      values: {
        now: `${dateLong(r.start, lang)} – ${dateLong(r.end, lang)}`,
        days: unit(lang, `${r.days} วัน`, `${r.days} days`),
        compare: baseline,
      },
    },
    {
      id: "revenue",
      about: th ? "รายได้ (ไม่รวมค่าส่งและบิลที่ยกเลิก) ช่วงนี้เทียบช่วงก่อน" : "revenue (excl. freight and cancelled bills) vs the previous period",
      values: { now: money(c.revenue), previous_period: money(p.revenue), amount: money(Math.abs(c.revenue - p.revenue)), ...change(lang, g.revenue) },
    },
  ];
  if (c.orders !== null && p.orders !== null) {
    facts.push({
      id: "orders", about: th ? "จำนวนคำสั่งซื้อ (บิล)" : "number of orders (bills)",
      values: { now: unit(lang, `${count(c.orders)} คำสั่งซื้อ`, `${count(c.orders)} orders`),
                previous_period: unit(lang, `${count(p.orders)} คำสั่งซื้อ`, `${count(p.orders)} orders`), ...change(lang, g.orders) },
    });
  }
  if (c.aov !== null && p.aov !== null) {
    facts.push({ id: "aov", about: th ? "ยอดเฉลี่ยต่อคำสั่งซื้อ" : "average order value",
      values: { now: money2(c.aov), previous_period: money2(p.aov), ...change(lang, g.aov) } });
  }
  if (c.customers !== null && p.customers !== null) {
    facts.push({ id: "customers", about: th ? "จำนวนลูกค้าไม่นับซ้ำ" : "unique customers",
      values: { now: unit(lang, `${count(c.customers)} คน`, `${count(c.customers)} customers`), ...change(lang, g.customers) } });
  }
  if (c.on_time_rate !== null) {
    const pts = d.kpis.on_time_change_pts;
    facts.push({ id: "ontime", about: th ? "สัดส่วนการส่งของตรงเวลา (pts = จุดเปอร์เซ็นต์)" : "on-time delivery rate (pts = percentage points)",
      values: { now: `${num1(c.on_time_rate)}%`,
        ...(pts === null ? {} : { dir: change(lang, pts).dir, pts: unit(lang, `${num1(Math.abs(pts))} จุด`, `${num1(Math.abs(pts))} pts`) }) } });
  }
  d.by_category.filter((x) => x.key !== "Other").slice(0, 3).forEach((x, i) => facts.push({
    id: `cat${i + 1}`, about: th ? `หมวดสินค้าที่ทำรายได้สูงสุดอันดับ ${i + 1}` : `category #${i + 1} by revenue`,
    values: { name: `“${categoryLabel(x.key, lang)}”`, revenue: money(x.revenue), share: `${num1(x.share ?? 0)}%` },
  }));
  (d.rank_product?.top ?? []).slice(0, 3).forEach((x, i) => facts.push({
    id: `prod${i + 1}`, about: th ? `สินค้าขายดีอันดับ ${i + 1}` : `best-selling product #${i + 1}`,
    values: { name: `“${x.label}”`, revenue: money(x.revenue), share: `${num1(x.share ?? 0)}%`, ...change(lang, x.change_pct) },
  }));
  const peak = [...d.by_hour].sort((a, b) => b.revenue - a.revenue)[0];
  if (peak && peak.revenue > 0 && ctx.hasTime !== false) {       // no clock times in the data -> no "busiest hour"
    facts.push({ id: "peak_hour", about: th ? "ชั่วโมงที่ขายได้มากที่สุด" : "busiest hour",
      values: { name: unit(lang, `${peak.label} น.`, peak.label), revenue: money(peak.revenue) } });
  }
  const days = [...d.by_weekday].filter((x) => x.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  if (days.length > 1) {
    const name = (k: string, l: string) => (th ? `วัน${WEEKDAY_TH[Number(k)]}` : l);
    facts.push({ id: "weekday", about: th ? "วันในสัปดาห์ที่ขายดีที่สุดและน้อยที่สุด" : "strongest and weakest weekday",
      values: { best: name(days[0].key, days[0].label), worst: name(days[days.length - 1].key, days[days.length - 1].label) } });
  }
  facts.push(...driverFacts(d.drivers.segments, lang, ctx, baseline));
  return { lang, facts };
}

export function dailyFactSet(rep: DailyReport, lang: Lang, ctx: FactContext = {}): FactSet {
  const t = rep.today, b = rep.baseline_7d_avg, ch = rep.change_pct, m = rep.month_to_date;
  const th = lang === "th";
  const baseline = th ? "ค่าเฉลี่ยรายวันของ 7 วันก่อน" : "the 7-day daily average";
  const facts: Fact[] = [
    { id: "date", about: th ? "วันที่ของรายงาน" : "report date", values: { name: dateWithDay(rep.date, lang), compare: baseline } },
    { id: "revenue", about: th ? `รายได้วันนี้เทียบกับ${baseline}` : `today's revenue vs ${baseline}`,
      values: { now: money(t.revenue), avg: money(b.revenue), ...change(lang, ch.revenue_vs_7d_avg) } },
    { id: "prev_day", about: th ? "รายได้วันนี้เทียบกับเมื่อวาน" : "today's revenue vs the previous day",
      values: { previous_day_revenue: money(rep.previous_day.revenue), ...change(lang, ch.revenue_vs_prev_day) } },
    { id: "last_week", about: th ? "รายได้วันนี้เทียบกับวันเดียวกันของสัปดาห์ก่อน" : "vs the same weekday last week",
      values: { last_week_revenue: money(rep.same_day_last_week.revenue), ...change(lang, ch.revenue_vs_same_day_last_week) } },
    { id: "mtd", about: th ? "ยอดสะสมเดือนนี้เทียบกับช่วงเดียวกันของเดือนก่อน" : "month to date vs the same days last month",
      values: { now: money(m.revenue), last_month_same_days: money(m.prev_month_same_days_revenue), ...change(lang, m.change_pct) } },
  ];
  if (t.orders !== null) {
    facts.push({ id: "orders", about: th ? `จำนวนคำสั่งซื้อวันนี้เทียบกับ${baseline}` : `orders today vs ${baseline}`,
      values: { now: unit(lang, `${count(t.orders)} คำสั่งซื้อ`, `${count(t.orders)} orders`), ...change(lang, ch.orders_vs_7d_avg) } });
  }
  if (t.aov !== null) {
    facts.push({ id: "aov", about: th ? "ยอดเฉลี่ยต่อคำสั่งซื้อวันนี้" : "average order value today",
      values: { now: money2(t.aov), ...change(lang, ch.aov_vs_7d_avg) } });
  }
  if (rep.anomaly) {
    facts.push({ id: "alert", about: th ? "ยอดขายวันนี้ผิดปกติ (ต่างจากค่าเฉลี่ย 7 วันตั้งแต่ 25%)" : "unusual day (25%+ away from the 7-day average)",
      values: { text: rep.anomaly === "drop" ? unit(lang, "ยอดขายลดลงผิดปกติ", "an unusual drop") : unit(lang, "ยอดขายสูงผิดปกติ", "an unusual spike") } });
  }
  rep.top_categories.filter((x) => x.key !== "Other").slice(0, 3).forEach((x, i) => facts.push({
    id: `cat${i + 1}`, about: th ? `หมวดสินค้าขายดีวันนี้อันดับ ${i + 1}` : `top category today #${i + 1}`,
    values: { name: `“${categoryLabel(x.key, lang)}”`, revenue: money(x.revenue), share: `${num1(x.share ?? 0)}%` },
  }));
  facts.push(...driverFacts(rep.drivers.segments, lang, ctx, baseline));
  return { lang, facts };
}

/** How the facts are shown to the AI: every placeholder with the value it will become. */
export function factsForPrompt(set: FactSet): string {
  return set.facts.map((f) => {
    const vals = Object.entries(f.values).map(([k, v]) => `  {${f.id}.${k}} = ${v}`).join("\n");
    return `${f.id}: ${f.about}\n${vals}`;
  }).join("\n");
}

const PLACEHOLDER = /\{([a-z_0-9]+)\.([a-z_]+)\}/g;

const THAI_OR_LATIN_LETTER = /[ก-ฺเ-๎a-zA-Z]/;   // Thai letters and marks (not ฿ U+0E3F), Latin
const UNIT_WORDS = ["คำสั่งซื้อ", "คน", "วัน", "จุด", "orders", "customers", "days", "pts"];

/**
 * Fills the placeholders. Thai puts a space around numbers and quoted names, so a value that
 * starts or ends with a digit, symbol or quote gets a space next to a letter; a unit the AI
 * repeated after a value that already has it ("80 คน คน") is dropped.
 */
export function renderDraft(text: string, set: FactSet): string {
  const index = new Map(set.facts.map((f) => [f.id, f.values]));
  let out = text.replace(PLACEHOLDER, (all, id: string, key: string, offset: number, whole: string) => {
    const v = index.get(id)?.[key];
    if (v === undefined) return all;
    const before = whole[offset - 1] ?? " ";
    const after = whole[offset + all.length] ?? " ";
    const lead = !THAI_OR_LATIN_LETTER.test(v[0]) && THAI_OR_LATIN_LETTER.test(before) ? " " : "";
    const trail = !THAI_OR_LATIN_LETTER.test(v[v.length - 1]) && THAI_OR_LATIN_LETTER.test(after) ? " " : "";
    return lead + v + trail;
  });
  // names like 'ประเทศ “USA”' already carry their dimension - drop it if the AI wrote it too
  const dims = set.facts.map((f) => f.values.name?.split(" “")[0]).filter((w): w is string => Boolean(w && !w.startsWith("“")));
  for (const u of [...UNIT_WORDS, ...new Set(dims)]) out = out.split(`${u} ${u}`).join(u).split(`${u}${u}`).join(u);
  // {x.dir} {x.cmp} written together ("เพิ่มขึ้น สูงกว่า"): keep the comparison only
  out = out.replace(/(เพิ่มขึ้น|ลดลง|ทรงตัว) ?(สูงกว่า|ต่ำกว่า|ใกล้เคียงกับ)/g, "$2").replace(/\b(rose|fell|was flat) (above|below|in line with)\b/g, "was $2");
  out = out
    .replace(/(\S{4,}) \1(?=\s|$)/g, "$1")                                      // "ค่าเฉลี่ยของ ค่าเฉลี่ยของ" -> once
    .replace(/(คำสั่งซื้อ) (บิล|รายการ)(?=\s|$)/g, "$1")                         // "14 คำสั่งซื้อ บิล"
    .replace(/วันที่ (วัน[ก-๎]+ที่ )/g, "$1")                          // "วันที่ วันจันทร์ที่ ..."
    .replace(/(สัปดาห์|วัน|เดือน) \1(ล่าสุด|ที่ผ่านมา)/g, "$1$2")          // "4 สัปดาห์ สัปดาห์ล่าสุด"
    .replace(/([ก-๎]) (เพิ่มขึ้น|ลดลง|ทรงตัว|สูงกว่า|ต่ำกว่า|ใกล้เคียงกับ)/g, "$1$2"); // "ซึ่ง เพิ่มขึ้น"
  return out.replace(/ {2,}/g, " ");
}

// Direction / comparison words the AI must not write on its own.
const DIRECTION_TH = ["เพิ่มขึ้น", "ลดลง", "สูงขึ้น", "ต่ำลง", "สูงกว่า", "ต่ำกว่า", "เติบโต", "หดตัว", "ขยายตัว",
  "ร่วง", "พุ่ง", "ทรงตัว", "ดีขึ้น", "แย่ลง", "ถดถอย", "มากขึ้น", "น้อยลง", "ยอดตก", "ขายตก"];
const DIRECTION_EN = /\b(increas\w*|decreas\w*|grew|grow\w*|rose|ris(e|es|ing)|fell|fall\w*|drop\w*|declin\w*|up|down|higher|lower|above|below|gain\w*|jump\w*|surg\w*|plung\w*|slump\w*|flat|more|less|fewer)\b/i;

export type DraftCheck = { ok: boolean; issues: string[] };

/** Checks the AI's placeholder text BEFORE it is filled in. */
export function checkDraft(text: string, set: FactSet): DraftCheck {
  const issues: string[] = [];
  const known = new Set(set.facts.flatMap((f) => Object.keys(f.values).map((k) => `${f.id}.${k}`)));
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!known.has(`${m[1]}.${m[2]}`)) issues.push(`unknown placeholder {${m[1]}.${m[2]}}`);
  }
  const bare = text.replace(PLACEHOLDER, " ");
  const digits = bare.match(/[0-9๐-๙]+/g);
  if (digits) issues.push(`wrote numbers itself: ${[...new Set(digits)].join(", ")}`);
  const thWords = DIRECTION_TH.filter((w) => bare.includes(w));
  if (thWords.length) issues.push(`wrote direction words itself: ${thWords.join(", ")}`);
  const en = bare.match(DIRECTION_EN);
  if (en) issues.push(`wrote direction words itself: ${en[0]}`);
  if (/[{}]/.test(bare)) issues.push("broken placeholder (stray { or })");
  return { ok: issues.length === 0, issues };
}
