// Number and date formatting shared by the dashboard, the AI facts and the email.
// Currency comes from the database (app_state.currency): R$ for the Olist data,
// ฿ for a Thai shop's imported file. Server pages call setCurrency() once per request;
// client charts pass the symbol explicitly.
import type { Lang } from "./types";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SYMBOLS: Record<string, string> = { BRL: "R$", THB: "฿", USD: "$", EUR: "€", JPY: "¥", GBP: "£" };
export const CURRENCY_NAME_TH: Record<string, string> = {
  BRL: "เรอัลบราซิล", THB: "บาท", USD: "ดอลลาร์สหรัฐ", EUR: "ยูโร", JPY: "เยน", GBP: "ปอนด์",
};
export const currencySymbol = (code: string | null | undefined) => SYMBOLS[code ?? ""] ?? (code || "R$");

let SYM = "R$";
export function setCurrency(code: string | null | undefined) {
  SYM = currencySymbol(code);
}
export const getSymbol = () => SYM;

/** ฿ 940,487  (whole units) */
export const money = (n: number, sym = SYM) => `${n < 0 ? "-" : ""}${sym} ${int.format(Math.abs(Math.round(n)))}`;

/** ฿ 178.06  (for averages) */
export const money2 = (n: number, sym = SYM) => `${n < 0 ? "-" : ""}${sym} ${dec2.format(Math.abs(n))}`;

/** ฿ 940k / ฿ 1.2M - axis labels only, never in text the AI sees */
export function moneyCompact(n: number, sym = SYM): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${sym}${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sym}${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sym}${Math.round(n)}`;
}

export const count = (n: number) => int.format(n);
export const num1 = (n: number) => dec1.format(n);

/** +6.0% / -6.0% / n/a */
export const pct = (n: number | null | undefined, na = "n/a") =>
  n === null || n === undefined ? na : `${n > 0 ? "+" : ""}${dec1.format(n)}%`;

/** +4.6 pts / +4.6 จุด */
export const pts = (n: number | null | undefined, lang: Lang = "en") =>
  n === null || n === undefined
    ? lang === "th" ? "ไม่มีข้อมูล" : "n/a"
    : `${n > 0 ? "+" : ""}${dec1.format(n)} ${lang === "th" ? "จุด" : "pts"}`;

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MONTHS_TH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม",
  "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const DAYS_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** th: 24 พ.ค. 2561 (พ.ศ.) · en: 24 May 2018 */
export function dateLong(iso: string, lang: Lang = "th"): string {
  const { y, m, d } = parts(iso);
  return lang === "th" ? `${d} ${MONTHS_TH[m - 1]} ${y + 543}` : `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

/** th: 24 พฤษภาคม 2561 */
export function dateFull(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS_TH_FULL[m - 1]} ${y + 543}`;
}

/** th: 24 พ.ค. · en: 24 May */
export function dateShort(iso: string, lang: Lang = "th"): string {
  const { m, d } = parts(iso);
  return lang === "th" ? `${d} ${MONTHS_TH[m - 1]}` : `${d} ${MONTHS_EN[m - 1]}`;
}

/** th: วันพฤหัสบดีที่ 24 พ.ค. 2561 · en: Thu 24 May 2018 */
export function dateWithDay(iso: string, lang: Lang = "th"): string {
  const { dow } = parts(iso);
  return lang === "th" ? `วัน${DAYS_TH[dow]}ที่ ${dateLong(iso, "th")}` : `${DAYS_EN[dow]} ${dateLong(iso, "en")}`;
}

/** ISO date arithmetic without time-zone surprises */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** snake_case category -> "Bed bath table" */
export const prettyLabel = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

/** For KPIs the data may not be able to answer (no bill numbers / customer ids in an imported file). */
export const NA_TH = "ไม่มีข้อมูล";
export const countOr = (n: number | null | undefined, na = NA_TH) => (n === null || n === undefined ? na : count(n));
export const money2Or = (n: number | null | undefined, na = NA_TH, sym?: string) =>
  n === null || n === undefined ? na : money2(n, sym);
