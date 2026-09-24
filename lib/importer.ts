// Turns rows from any shop's sales file (CSV / Excel, Thai or English headers)
// into the line items that import_sales() in 003_features.sql expects.
// Runs in the browser (preview before upload) and again on the server (never trust the client).

export type Field =
  | "order_id" | "ordered_at" | "time" | "product" | "category" | "quantity"
  | "unit_price" | "total" | "region" | "customer_id" | "status";

export const FIELDS: { id: Field; label: string; hint: string; aliases: string[] }[] = [
  { id: "ordered_at", label: "วันที่ (และเวลา)", hint: "จำเป็น เช่น 2024-05-01 09:15 หรือ 01/05/2567 09:15",
    aliases: ["ordered_at", "datetime", "date_time", "timestamp", "order_date", "order date", "purchase_date", "date",
      "วันเวลา", "วันที่และเวลา", "วันที่เวลา", "วันที่ขาย", "วันที่สั่งซื้อ", "วันที่"] },
  { id: "time", label: "เวลา (ถ้าแยกคอลัมน์)", hint: "เช่น 09:15",
    aliases: ["time", "order_time", "เวลา", "เวลาขาย"] },
  { id: "order_id", label: "เลขที่บิล / คำสั่งซื้อ", hint: "ถ้าไม่มี แต่ละแถวจะนับเป็น 1 บิล",
    aliases: ["order_id", "order id", "order_no", "order", "bill", "bill_no", "receipt", "receipt_no", "invoice", "invoice_no",
      "เลขที่บิล", "เลขที่ใบเสร็จ", "เลขที่คำสั่งซื้อ", "เลขที่ออเดอร์", "ออเดอร์", "บิล", "ใบเสร็จ"] },
  { id: "product", label: "ชื่อสินค้า", hint: "ใช้จัดอันดับสินค้าขายดี/ขายน้อย",
    aliases: ["product", "product_name", "product name", "item", "item_name", "menu", "sku_name",
      "ชื่อสินค้า", "สินค้า", "รายการ", "รายการสินค้า", "เมนู"] },
  { id: "category", label: "หมวดสินค้า", hint: "ถ้าไม่มี จะใช้ “ไม่ระบุหมวด”",
    aliases: ["category", "product_category", "productline", "product_line", "type", "group", "หมวด", "หมวดหมู่", "หมวดสินค้า", "ประเภท", "ประเภทสินค้า", "กลุ่มสินค้า"] },
  { id: "quantity", label: "จำนวน", hint: "ถ้าไม่มี ถือว่า 1",
    aliases: ["quantity", "qty", "units", "จำนวน", "จำนวนชิ้น", "จำนวนที่ขาย"] },
  { id: "unit_price", label: "ราคาต่อหน่วย", hint: "ใช้ถ้าไม่มียอดรวม",
    aliases: ["unit_price", "unit price", "price", "ราคา", "ราคาต่อหน่วย", "ราคาต่อชิ้น"] },
  { id: "total", label: "ยอดขาย (รวมต่อแถว)", hint: "ถ้ามี จะใช้ค่านี้เป็นรายได้",
    aliases: ["net_sales", "netsales", "net_amount", "total", "amount", "line_total", "sales", "revenue", "subtotal",
      "ยอดขาย", "ยอดรวม", "รวม", "รวมเงิน", "มูลค่า", "ยอดเงิน", "จำนวนเงิน", "รายได้"] },
  { id: "region", label: "สาขา / พื้นที่", hint: "ใช้แยกยอดขายตามสาขา",
    aliases: ["branch", "store", "shop", "region", "location", "country", "territory", "province", "state", "city",
      "สาขา", "ร้าน", "ร้านค้า", "พื้นที่", "ภูมิภาค", "จังหวัด", "ภาค"] },
  { id: "customer_id", label: "รหัสลูกค้า", hint: "ใช้นับจำนวนลูกค้า ถ้าไม่มีจะนับ 1 บิลเป็น 1 ลูกค้า",
    aliases: ["customer_id", "customer", "customer_name", "member_id", "member", "ลูกค้า", "รหัสลูกค้า", "สมาชิก", "รหัสสมาชิก"] },
  { id: "status", label: "สถานะ", hint: "แถวที่เป็น “ยกเลิก” จะไม่นับเป็นรายได้",
    aliases: ["status", "order_status", "สถานะ", "สถานะคำสั่งซื้อ"] },
];

export type Mapping = Partial<Record<Field, number>>;
export type Cell = string | number | boolean | Date | null | undefined;

/**
 * One sold line, as sent to import_stage() in 004_import_batches.sql.
 * order_id / customer_id are null when the file has no such column: the database then
 * makes a batch-unique id, and the KPIs that need them show "ไม่มีข้อมูล" instead of guessing.
 */
export type LineItem = {
  row_no: number; order_id: string | null; item_seq: number; ordered_at: string;
  customer_id: string | null; region: string; product_id: string; product_name: string | null;
  category: string; quantity: number; price: number; status: "delivered" | "canceled";
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.:()]/g, "");

/** Guess which column holds which field from the header row. */
export function guessMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const m: Mapping = {};
  const cols = headers.map((h) => norm(String(h ?? "")));
  // exact alias match first, then "header contains alias"
  for (const pass of ["exact", "contains"] as const) {
    for (const f of FIELDS) {
      if (m[f.id] !== undefined) continue;
      for (const a of f.aliases) {
        const na = norm(a);
        const i = cols.findIndex((c, idx) => !used.has(idx) && c && (pass === "exact" ? c === na : c.includes(na)));
        if (i >= 0) { m[f.id] = i; used.add(i); break; }
      }
    }
  }
  return m;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;

function validDate(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (y > 2400) y -= 543;                                  // พ.ศ. -> ค.ศ.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1990 && y <= 2100 && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d &&
    h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 60;
}

function parseTime(v: Cell): [number, number, number] | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return [v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()];
  if (typeof v === "number" && v >= 0 && v < 1) {          // Excel time fraction
    const secs = Math.round(v * 86400);
    return [Math.floor(secs / 3600) % 24, Math.floor(secs / 60) % 60, secs % 60];
  }
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(น\.?|am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[4] ?? "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return [h, Number(m[2]), Number(m[3] ?? 0)];
}

/** DMY = วัน/เดือน/ปี (Thai, European) · MDY = เดือน/วัน/ปี (US) */
export type DateOrder = "DMY" | "MDY";

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/;

/**
 * Decide DMY vs MDY from the whole column: a first part above 12 can only be a day
 * (DMY), a second part above 12 can only be a day (MDY). Undecided -> Thai DMY.
 */
export function detectDateOrder(values: Cell[]): { order: DateOrder; sure: boolean } {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(SLASH_DATE);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (mdy > dmy) return { order: "MDY", sure: true };
  if (dmy > 0) return { order: "DMY", sure: true };
  return { order: "DMY", sure: false };
}

/** Returns "YYYY-MM-DD HH:MM:SS" or null. Accepts ISO, D/M/Y or M/D/Y (พ.ศ. ok), Excel dates and serials. */
export function parseDateTime(v: Cell, time?: Cell, order: DateOrder = "DMY"): string | null {
  if (v === null || v === undefined || v === "") return null;
  let y: number, mo: number, d: number, h = 0, mi = 0, s = 0;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    [y, mo, d, h, mi, s] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds()];
  } else if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;               // Excel serial date (1954-2119)
    const ms = Math.round((v - 25569) * 86400) * 1000;
    const dt = new Date(ms);
    [y, mo, d, h, mi, s] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds()];
  } else {
    const t = String(v).trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    } else {
      m = t.match(SLASH_DATE);
      if (!m) return null;
      y = Number(m[3]);
      if (y < 100) y += y >= 50 ? 2500 : 2000;             // 2-digit year: 67 -> 2567 (พ.ศ.), 24 -> 2024
      const [a, b] = [Number(m[1]), Number(m[2])];
      [d, mo] = order === "DMY" ? [a, b] : [b, a];
      [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
    }
  }
  const tt = parseTime(time);
  if (tt) [h, mi, s] = tt;
  if (!validDate(y, mo, d, h, mi, s)) return null;
  if (y > 2400) y -= 543;
  return fmt(y, mo, d, h, mi, s);
}

export function parseNumber(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[฿$€,\s]|บาท/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const text = (v: Cell, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const CANCELED = /cancel|ยกเลิก|void|refund|คืนเงิน/i;

export type ParseResult = {
  items: LineItem[];
  rejected: { row: number; reason: string }[];
  stats: {
    rows: number;
    orders: number | null;           // null: the file has no bill numbers
    customers: number | null;        // null: the file has no customer ids
    units: number | null;            // null: the file has no quantity column
    revenue: number;
    minDate: string | null; maxDate: string | null;
    hasTime: boolean; hasProducts: boolean; hasRegion: boolean;
    hasOrderIds: boolean; hasCustomerIds: boolean; hasQuantity: boolean;
    canceled: number;
    zeroRows: number;                // rows with no sale (shop closed, item not sold): skipped, not errors
    dateOrder: DateOrder; dateOrderSure: boolean;
  };
};

/** rows = data rows only (no header). Row numbers in errors are 1-based spreadsheet rows (header = row 1). */
export function toLineItems(rows: Cell[][], m: Mapping, dateOrder?: DateOrder): ParseResult {
  const detected = detectDateOrder(m.ordered_at === undefined ? [] : rows.map((r) => r?.[m.ordered_at!]));
  const order = dateOrder ?? detected.order;
  const hasOrderIds = m.order_id !== undefined;
  const hasCustomerIds = m.customer_id !== undefined;
  const hasQuantity = m.quantity !== undefined;
  const items: LineItem[] = [];
  const rejected: ParseResult["rejected"] = [];
  const seq = new Map<string, number>();
  const orders = new Set<string>();
  const customers = new Set<string>();
  let revenue = 0, units = 0, minDate: string | null = null, maxDate: string | null = null;
  let hasTime = false, canceled = 0, zeroRows = 0;
  const get = (r: Cell[], f: Field) => (m[f] === undefined ? undefined : r[m[f]!]);

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    if (!r || r.every((c) => c === null || c === undefined || c === "")) return;   // blank line
    const at = parseDateTime(get(r, "ordered_at"), get(r, "time"), order);
    if (!at) return void rejected.push({ row: rowNo, reason: "วันที่ไม่ถูกต้องหรือว่าง" });

    const qty = hasQuantity ? parseNumber(get(r, "quantity")) : 1;
    if (qty === null || qty < 0) return void rejected.push({ row: rowNo, reason: "จำนวนไม่ถูกต้อง" });
    const unit = parseNumber(get(r, "unit_price"));
    const total = parseNumber(get(r, "total"));
    const price = total ?? (unit !== null ? unit * qty : null);
    if (price === null) return void rejected.push({ row: rowNo, reason: "ไม่มียอดขายหรือราคา" });
    if (price < 0) return void rejected.push({ row: rowNo, reason: "ยอดขายติดลบ" });
    if (price > 1e9) return void rejected.push({ row: rowNo, reason: "ยอดขายสูงผิดปกติ" });
    if (price === 0 || qty === 0) { zeroRows++; return; }             // no sale that day / item: fine, just nothing to store

    const billNo = hasOrderIds ? text(get(r, "order_id"), 80) : null;
    if (hasOrderIds && !billNo) return void rejected.push({ row: rowNo, reason: "ไม่มีเลขบิล" });
    const customer = hasCustomerIds ? text(get(r, "customer_id"), 80) : null;
    const product = text(get(r, "product"), 120);
    const category = text(get(r, "category"), 80) ?? "ไม่ระบุหมวด";
    const status = CANCELED.test(text(get(r, "status")) ?? "") ? "canceled" : "delivered";
    const n = billNo ? (seq.get(billNo) ?? 0) + 1 : 1;
    if (billNo) seq.set(billNo, n);

    items.push({
      row_no: rowNo,
      order_id: billNo,
      item_seq: n,
      ordered_at: at,
      customer_id: customer,
      region: text(get(r, "region"), 80) ?? "ไม่ระบุ",
      product_id: product ? `p:${product}` : `c:${category}`,
      product_name: product,
      category,
      quantity: Math.round(qty * 1000) / 1000,
      price: Math.round(price * 100) / 100,
      status,
    });
    if (status === "canceled") { canceled++; return; }
    if (billNo) orders.add(billNo);
    if (customer) customers.add(customer);
    revenue += price;
    units += qty;
    const day = at.slice(0, 10);
    if (!minDate || day < minDate) minDate = day;
    if (!maxDate || day > maxDate) maxDate = day;
    if (!at.endsWith("00:00:00")) hasTime = true;
  });

  return {
    items, rejected,
    stats: {
      rows: items.length,
      orders: hasOrderIds ? orders.size : null,
      customers: hasCustomerIds ? customers.size : null,
      units: hasQuantity ? Math.round(units * 1000) / 1000 : null,
      revenue: Math.round(revenue * 100) / 100,
      minDate, maxDate, hasTime,
      hasProducts: m.product !== undefined, hasRegion: m.region !== undefined,
      hasOrderIds, hasCustomerIds, hasQuantity, canceled, zeroRows,
      dateOrder: order, dateOrderSure: dateOrder !== undefined || detected.sure,
    },
  };
}

/** Server-side check of items coming from the browser. Returns the bad field name or null. */
export function checkItem(x: unknown): string | null {
  if (!x || typeof x !== "object") return "ไม่ใช่ออบเจ็กต์";
  const o = x as Record<string, unknown>;
  const str = (k: string, max: number, nullable = false) =>
    (nullable && o[k] === null) || (typeof o[k] === "string" && (o[k] as string).length > 0 && (o[k] as string).length <= max);
  const num = (k: string, min: number, max: number) => typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) > min && (o[k] as number) <= max;
  if (!Number.isInteger(o.row_no) || (o.row_no as number) < 1) return "row_no";
  if (!str("order_id", 80, true)) return "order_id";
  if (!Number.isInteger(o.item_seq) || (o.item_seq as number) < 1) return "item_seq";
  if (typeof o.ordered_at !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o.ordered_at)) return "ordered_at";
  if (!str("customer_id", 80, true)) return "customer_id";
  if (!str("region", 80) || !str("product_id", 130) || !str("category", 80)) return "text field";
  if (!str("product_name", 120, true)) return "product_name";
  if (!num("quantity", 0, 1e7)) return "quantity";
  if (!num("price", 0, 1e9)) return "price";
  if (o.status !== "delivered" && o.status !== "canceled") return "status";
  return null;
}
