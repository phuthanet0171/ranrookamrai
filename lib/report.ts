// Builds the daily report: email (subject + HTML + plain text) and a short chat message
// for Discord / Telegram / LINE. Email clients ignore <style> blocks and modern CSS,
// so everything is inline and table-based.
import type { DailyReport, Insight, Lang } from "./types";
import { count, countOr, dateWithDay, money, money2, money2Or, num1, pct } from "./format";
import { categoryLabel, dimensionLabel, segmentLabel } from "./labels";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GREEN = "#047857", RED = "#b42323", INK = "#0f172a", MUTED = "#64748b", LINE = "#e3e6eb", BLUE = "#2563eb";
const FONT = "'IBM Plex Sans Thai','Noto Sans Thai','Leelawadee UI',Tahoma,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

const T = {
  th: {
    title: "รายงานยอดขายประจำวัน", revenue: "รายได้", orders: "คำสั่งซื้อ", aov: "ยอดเฉลี่ยต่อคำสั่งซื้อ",
    vs7: "เทียบกับค่าเฉลี่ย 7 วัน", next: "ควรทำต่อ:", moved: "ส่วนที่ทำให้รายได้เปลี่ยน (เทียบกับค่าเฉลี่ย 7 วัน)",
    topCats: "หมวดสินค้าขายดีวันนี้", mtd: "ยอดสะสมเดือนนี้", mtdVs: "เทียบกับช่วงเดียวกันของเดือนก่อน",
    open: "เปิด dashboard →", sent: "ส่งอัตโนมัติโดย n8n", drop: "⚠ ยอดขายลดลงผิดปกติ", spike: "▲ ยอดขายสูงผิดปกติ",
    alertText: (p: string) => `รายได้ ${p} เมื่อเทียบกับค่าเฉลี่ย 7 วัน (เกณฑ์แจ้งเตือน 25%)`,
    aiOk: (m: string) => `สรุปโดย AI (${m}) · ตัวเลขและคำว่าเพิ่ม/ลดเติมจากฐานข้อมูล ✓`, rule: "สรุปจากระบบ (ไม่ใช้ AI)",
    subjAlert: "⚠️ แจ้งเตือน ยอดขายลดลง · ", subjSpike: "📈 ยอดขายพุ่ง · ", subj: "รายงานยอดขาย", vsShort: "เทียบค่าเฉลี่ย 7 วัน",
    na: "ไม่มีข้อมูล", noBills: "ไฟล์ไม่มีเลขบิล",
  },
  en: {
    title: "Daily sales report", revenue: "Revenue", orders: "Orders", aov: "Avg order value",
    vs7: "vs 7-day avg", next: "Next step:", moved: "What moved revenue (vs 7-day average)",
    topCats: "Top categories today", mtd: "Month to date", mtdVs: "vs same days last month",
    open: "Open the dashboard →", sent: "Sent automatically by n8n", drop: "⚠ Unusual drop", spike: "▲ Unusual spike",
    alertText: (p: string) => `revenue is ${p} vs the 7-day average (alert threshold: 25%)`,
    aiOk: (m: string) => `AI summary (${m}) · numbers and up/down words filled in from the database ✓`, rule: "Rule-based summary",
    subjAlert: "⚠️ ALERT: sales drop · ", subjSpike: "📈 Sales spike · ", subj: "Daily Sales", vsShort: "vs 7-day avg",
    na: "n/a", noBills: "no bill numbers in the data",
  },
};

function delta(n: number | null, lang: Lang): string {
  if (n === null) return `<span style="color:${MUTED}">${T[lang].na}</span>`;
  const up = n >= 0;
  return `<span style="color:${up ? GREEN : RED};font-weight:600">${up ? "&#9650;" : "&#9660;"} ${esc(pct(n))}</span>`;
}

export function buildSubject(r: DailyReport, lang: Lang = "th"): string {
  const t = T[lang];
  const chg = r.change_pct.revenue_vs_7d_avg;
  const arrow = chg === null ? "" : chg >= 0 ? "▲" : "▼";
  const prefix = r.anomaly === "drop" ? t.subjAlert : r.anomaly === "spike" ? t.subjSpike : "";
  return `${prefix}${t.subj} ${dateWithDay(r.date, lang)} · ${money(r.today.revenue)} (${arrow}${pct(chg, t.na)} ${t.vsShort})`;
}

/** Short plain-text message for chat apps (Discord 2000 / Telegram 4096 character limits). */
export function buildChatText(r: DailyReport, insight: Insight, lang: Lang = "th", dashboardUrl?: string): string {
  const t = T[lang], ch = r.change_pct;
  const lines = [
    `📊 ${t.title} · ${dateWithDay(r.date, lang)}`,
    r.anomaly ? `${r.anomaly === "drop" ? t.drop : t.spike}: ${t.alertText(pct(ch.revenue_vs_7d_avg, t.na))}` : "",
    `${t.revenue}: ${money(r.today.revenue)} (${pct(ch.revenue_vs_7d_avg, t.na)} ${t.vsShort})`,
    r.today.orders === null ? "" : `${t.orders}: ${count(r.today.orders)} · ${t.aov}: ${money2Or(r.today.aov, t.na)}`,
    "",
    `💡 ${insight.headline}`,
    ...insight.bullets.map((b) => `• ${b}`),
    `👉 ${t.next} ${insight.recommendation}`,
    dashboardUrl ? `\n${dashboardUrl}` : "",
  ];
  return lines.filter((l, i) => l !== "" || i === 4).join("\n").slice(0, 1900);
}

/** One row per day for Google Sheets / Excel logging. */
export function buildSheetRow(r: DailyReport, insight: Insight) {
  return {
    date: r.date,
    revenue: r.today.revenue,
    orders: r.today.orders,
    aov: r.today.aov,
    revenue_vs_7d_avg_pct: r.change_pct.revenue_vs_7d_avg,
    month_to_date_revenue: r.month_to_date.revenue,
    anomaly: r.anomaly ?? "",
    headline: insight.headline,
    summary_source: insight.source,
  };
}

export function buildEmail(r: DailyReport, insight: Insight, dashboardUrl?: string, lang: Lang = "th", region = "รัฐของลูกค้า") {
  const t = T[lang];
  const subject = buildSubject(r, lang);
  const td = r.today, b = r.baseline_7d_avg, ch = r.change_pct;

  const kpi = (label: string, value: string, sub: string) => `
    <td style="padding:14px 16px;border:1px solid ${LINE};border-radius:10px;vertical-align:top;width:33%">
      <div style="font-size:13px;color:${MUTED}">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${INK};margin:4px 0">${value}</div>
      <div style="font-size:12px;line-height:1.5">${sub}</div>
    </td>`;

  const alert = r.anomaly
    ? `<tr><td style="padding:12px 16px;background:${r.anomaly === "drop" ? "#fdecec" : "#e7f7ef"};border-radius:10px;font-size:14px;color:${INK}">
        <strong>${r.anomaly === "drop" ? t.drop : t.spike}</strong> — ${esc(t.alertText(pct(ch.revenue_vs_7d_avg, t.na)))}
      </td></tr><tr><td style="height:12px"></td></tr>`
    : "";

  const aiLabel = insight.source === "ai"
    ? esc(t.aiOk(insight.model ?? "Gemini"))
    : `${t.rule}${insight.note ? ` &middot; ${esc(insight.note)}` : ""}`;

  const rows = (cells: string[][]) =>
    cells.map((c, i) => `<tr style="background:${i % 2 ? "#f8fafc" : "#fff"}">${c.map((x, j) =>
      `<td style="padding:7px 10px;border-bottom:1px solid ${LINE};font-size:13px;${j > 0 ? "text-align:right;white-space:nowrap;" : ""}">${x}</td>`).join("")}</tr>`).join("");

  const cats = rows(r.top_categories.map((c) => [esc(categoryLabel(c.key, lang)), esc(money(c.revenue)), `${c.share ?? 0}%`]));
  const drivers = rows(r.drivers.segments.slice(0, 6).map((s) => [
    `<span style="color:${MUTED}">${esc(dimensionLabel(s.dimension, lang, region))}:</span> <strong>${esc(segmentLabel(s.dimension, s.segment, lang))}</strong>`,
    `<span style="color:${s.change < 0 ? RED : GREEN}">${s.change < 0 ? "&#9660;" : "&#9650;"} ${esc(money(Math.abs(s.change)))}</span>`,
    esc(pct(s.change_pct, "–")),
  ]));

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f1f5f9;font-family:${FONT};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden">
  <tr><td style="height:4px;background:linear-gradient(90deg,#2563eb,#7c3aed);background-color:#2563eb"></td></tr>
  <tr><td style="padding:22px 24px 0">
    <div style="font-size:13px;color:${BLUE};font-weight:600">${t.title}</div>
    <div style="font-size:21px;font-weight:700;margin:2px 0 16px">${esc(dateWithDay(r.date, lang))}</div>
  </td></tr>
  <tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${alert}</table></td></tr>
  <tr><td style="padding:0 16px"><table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>
    ${kpi(t.revenue, esc(money(td.revenue)), `${delta(ch.revenue_vs_7d_avg, lang)}<br><span style="color:${MUTED}">${t.vs7} ${esc(money(b.revenue))}</span>`)}
    ${td.orders === null ? kpi(t.orders, t.na, `<span style="color:${MUTED}">${t.noBills}</span>`)
      : kpi(t.orders, esc(count(td.orders)), `${delta(ch.orders_vs_7d_avg, lang)}<br><span style="color:${MUTED}">${t.vs7} ${esc(b.orders === null ? t.na : num1(b.orders))}</span>`)}
    ${td.aov === null ? kpi(t.aov, t.na, `<span style="color:${MUTED}">${t.noBills}</span>`)
      : kpi(t.aov, esc(money2(td.aov)), `${delta(ch.aov_vs_7d_avg, lang)}<br><span style="color:${MUTED}">${t.vs7} ${esc(money2Or(b.aov, t.na))}</span>`)}
  </tr></table></td></tr>
  <tr><td style="padding:16px 24px 0">
    <div style="font-size:17px;font-weight:700;margin-bottom:8px;line-height:1.5">${esc(insight.headline)}</div>
    <ul style="margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.7">
      ${insight.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}
    </ul>
    <div style="font-size:14px;background:#eef4ff;border-left:3px solid ${BLUE};padding:10px 14px;border-radius:6px;line-height:1.6">
      <strong>${t.next}</strong> ${esc(insight.recommendation)}
    </div>
    <div style="font-size:11.5px;color:${MUTED};margin-top:8px">${aiLabel}</div>
  </td></tr>
  <tr><td style="padding:22px 24px 0">
    <div style="font-size:14px;font-weight:700;margin-bottom:6px">${t.moved}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${drivers}</table>
  </td></tr>
  <tr><td style="padding:22px 24px 0">
    <div style="font-size:14px;font-weight:700;margin-bottom:6px">${t.topCats}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${cats}</table>
  </td></tr>
  <tr><td style="padding:22px 24px 24px;font-size:13.5px;color:${MUTED};line-height:1.6">
    ${t.mtd}: <strong style="color:${INK}">${esc(money(r.month_to_date.revenue))}</strong>
    (${delta(r.month_to_date.change_pct, lang)} ${t.mtdVs})
    ${dashboardUrl ? `<br><br><a href="${esc(dashboardUrl)}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">${t.open}</a>` : ""}
  </td></tr>
</table>
<div style="font-size:11.5px;color:${MUTED};padding-top:12px">${t.sent}</div>
</td></tr></table></body></html>`;

  const text = [
    subject, "",
    `${t.revenue}: ${money(td.revenue)} (${pct(ch.revenue_vs_7d_avg, t.na)} ${t.vs7} ${money(b.revenue)})`,
    `${t.orders}: ${countOr(td.orders, t.na)} (${pct(ch.orders_vs_7d_avg, t.na)})`,
    `${t.aov}: ${money2Or(td.aov, t.na)} (${pct(ch.aov_vs_7d_avg, t.na)})`, "",
    insight.headline, ...insight.bullets.map((x) => `- ${x}`), `${t.next} ${insight.recommendation}`, "",
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : "",
  ].join("\n");

  return { subject, html, text };
}
