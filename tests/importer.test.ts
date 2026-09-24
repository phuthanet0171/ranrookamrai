import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { checkItem, guessMapping, parseDateTime, parseNumber, toLineItems, type Cell } from "@/lib/importer";

describe("parseDateTime", () => {
  it.each([
    ["2024-05-01 09:15", "2024-05-01 09:15:00"],
    ["2024-05-01T23:59:59", "2024-05-01 23:59:59"],
    ["01/05/2567 09:15", "2024-05-01 09:15:00"],   // Thai day-first, พ.ศ.
    ["1/5/67", "2024-05-01 00:00:00"],             // 2-digit พ.ศ.
    ["05/01/2024", "2024-01-05 00:00:00"],         // day first, not US
    [45413.5, "2024-05-01 12:00:00"],              // Excel serial
  ])("%s -> %s", (input, want) => {
    expect(parseDateTime(input as Cell)).toBe(want);
  });

  it("rejects impossible or empty dates", () => {
    expect(parseDateTime("31/02/2569")).toBeNull();
    expect(parseDateTime("")).toBeNull();
    expect(parseDateTime("ไม่ทราบ")).toBeNull();
  });

  it("combines a separate time column (24h, am/pm, Excel fraction)", () => {
    expect(parseDateTime("01/05/2567", "14:30")).toBe("2024-05-01 14:30:00");
    expect(parseDateTime("01/05/2567", "2:30 pm")).toBe("2024-05-01 14:30:00");
    expect(parseDateTime(new Date(Date.UTC(2024, 4, 1)), 0.75)).toBe("2024-05-01 18:00:00");
  });
});

describe("parseNumber", () => {
  it("strips currency and separators", () => {
    expect(parseNumber("฿1,250.50")).toBe(1250.5);
    expect(parseNumber("120 บาท")).toBe(120);
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("guessMapping", () => {
  it("maps Thai headers", () => {
    const m = guessMapping(["เลขที่บิล", "วันที่", "เวลา", "สาขา", "สินค้า", "หมวดสินค้า", "จำนวน", "ราคาต่อหน่วย", "ยอดขาย"]);
    expect(m).toMatchObject({ order_id: 0, ordered_at: 1, time: 2, region: 3, product: 4, category: 5, quantity: 6, unit_price: 7, total: 8 });
  });
  it("maps English headers", () => {
    expect(guessMapping(["Date", "Product", "Qty", "Price", "Branch", "Order ID"]))
      .toMatchObject({ ordered_at: 0, product: 1, quantity: 2, unit_price: 3, region: 4, order_id: 5 });
  });
});

describe("toLineItems", () => {
  const headers = ["บิล", "วันที่", "สินค้า", "จำนวน", "ราคา", "สถานะ"];
  const m = guessMapping(headers);

  it("numbers items within a bill, uses qty x price, skips bad rows with a reason", () => {
    const r = toLineItems([
      ["A1", "2024-05-01 09:00", "ลาเต้", 2, 65, "สำเร็จ"],
      ["A1", "2024-05-01 09:00", "ครัวซองต์", 1, 55, "สำเร็จ"],
      ["A2", "", "ลาเต้", 1, 65, "สำเร็จ"],
      ["A3", "2024-05-02 10:00", "ลาเต้", 1, "", "สำเร็จ"],
      ["A4", "2024-05-02 11:00", "ลาเต้", 1, 65, "ยกเลิก"],
      [null, null, null, null, null, null],
    ], m);
    expect(r.items.map((i) => [i.order_id, i.item_seq, i.price, i.status])).toEqual([
      ["A1", 1, 130, "delivered"], ["A1", 2, 55, "delivered"], ["A4", 1, 65, "canceled"],
    ]);
    expect(r.rejected).toEqual([
      { row: 4, reason: "วันที่ไม่ถูกต้องหรือว่าง" },
      { row: 5, reason: "ไม่มียอดขายหรือราคา" },
    ]);
    expect(r.stats).toMatchObject({ orders: 1, revenue: 185, canceled: 1, minDate: "2024-05-01", units: 3 });
    expect(r.items[0]).toMatchObject({ quantity: 2, customer_id: null });   // no customer column: not guessed
    expect(r.stats.customers).toBeNull();
  });

  it("every item passes the server-side check", () => {
    const r = toLineItems([["A1", "2024-05-01 09:00", "ลาเต้", 1, 65, ""]], m);
    expect(r.items.map(checkItem)).toEqual([null]);
  });
});

describe("checkItem (server never trusts the browser)", () => {
  const ok = {
    row_no: 2, order_id: "A1", item_seq: 1, ordered_at: "2024-05-01 09:00:00", customer_id: "c", region: "r",
    product_id: "p:x", product_name: "x", category: "c", quantity: 1, price: 10, status: "delivered",
  };
  it("accepts missing bill number / customer (the database makes a batch-unique id)", () => {
    expect(checkItem({ ...ok, order_id: null, customer_id: null })).toBeNull();
  });
  it("accepts a valid item", () => expect(checkItem(ok)).toBeNull());
  it.each([
    [{ price: -5 }, "price"],
    [{ price: "10" }, "price"],
    [{ ordered_at: "2024-05-01" }, "ordered_at"],
    [{ status: "paid'; drop table orders;--" }, "status"],
    [{ quantity: 0 }, "quantity"],
    [{ row_no: 0 }, "row_no"],
    [{ order_id: "x".repeat(200) }, "order_id"],
  ])("rejects %o", (patch, field) => {
    expect(checkItem({ ...ok, ...patch })).toBe(field);
  });
});

describe("files without bill numbers or customers (daily totals per menu)", () => {
  const headers = ["วันที่", "สาขา", "เมนู", "จำนวน", "ยอดขาย"];
  const rows: Cell[][] = [
    ["2024-05-01", "สยาม", "ลาเต้", 10, 650],
    ["2024-05-01", "สยาม", "มอคค่า", 0, 0],          // menu not sold that day
    ["2024-05-02", "สยาม", "ลาเต้", 0, 0],           // shop closed
    ["2024-05-02", "อารีย์", "ลาเต้", 4, 260],
  ];
  const r = toLineItems(rows, guessMapping(headers));

  it("does not invent bill numbers or customers", () => {
    expect(r.items.every((i) => i.order_id === null && i.customer_id === null)).toBe(true);
    expect(r.stats).toMatchObject({ orders: null, customers: null, hasOrderIds: false, hasCustomerIds: false, units: 14 });
  });

  it("skips zero-sale rows without calling them errors", () => {
    expect(r.rejected).toEqual([]);
    expect(r.stats.zeroRows).toBe(2);
    expect(r.items).toHaveLength(2);
  });

  it("keeps the spreadsheet row number so ids stay unique inside the file", () => {
    expect(r.items.map((i) => i.row_no)).toEqual([2, 5]);
  });
});

describe("US-style file (Kaggle 'sales_data_sample.csv' layout)", () => {
  const headers = ["ORDERNUMBER", "QUANTITYORDERED", "PRICEEACH", "ORDERLINENUMBER", "SALES", "ORDERDATE", "STATUS",
    "QTR_ID", "MONTH_ID", "YEAR_ID", "PRODUCTLINE", "MSRP", "PRODUCTCODE", "CUSTOMERNAME", "PHONE", "ADDRESSLINE1",
    "ADDRESSLINE2", "CITY", "STATE", "POSTALCODE", "COUNTRY", "TERRITORY", "CONTACTLASTNAME", "CONTACTFIRSTNAME", "DEALSIZE"];
  const row = (order: string, date: string, sales: number, status = "Shipped") =>
    [order, 30, 95.7, 2, sales, date, status, 1, 2, 2003, "Motorcycles", 95, "S10_1678", "Land of Toys Inc.", "2125557818",
      "897 Long Airport Avenue", "", "NYC", "NY", "10022", "USA", "NA", "Yu", "Kwai", "Small"] as Cell[];

  it("maps the right columns (customer name, not phone; country; product line = category)", () => {
    expect(guessMapping(headers)).toMatchObject({
      order_id: 0, quantity: 1, unit_price: 2, total: 4, ordered_at: 5, status: 6,
      category: 10, product: 12, customer_id: 13, region: 20,
    });
  });

  it("detects month/day/year from the column and reads every row", () => {
    const r = toLineItems([row("10107", "2/24/2003 0:00", 2871), row("10100", "1/6/2003 0:00", 5151),
      row("10121", "5/7/2003 0:00", 2765.9, "Cancelled")], guessMapping(headers));
    expect(r.rejected).toEqual([]);
    expect(r.stats.dateOrder).toBe("MDY");
    expect(r.items.map((i) => i.ordered_at)).toEqual(["2003-02-24 00:00:00", "2003-01-06 00:00:00", "2003-05-07 00:00:00"]);
    expect(r.items[0]).toMatchObject({ customer_id: "Land of Toys Inc.", region: "USA", category: "Motorcycles", product_name: "S10_1678" });
    expect(r.items[2].status).toBe("canceled");
  });

  it("can be forced to day/month/year", () => {
    const r = toLineItems([row("1", "1/6/2003 0:00", 10)], guessMapping(headers), "DMY");
    expect(r.items[0].ordered_at).toBe("2003-06-01 00:00:00");
  });
});

describe("sample file shipped with the app", () => {
  it("parses with only the 3 deliberately broken rows rejected", () => {
    const file = path.join(__dirname, "..", "public", "samples", "thai-cafe-sales.csv");
    const rows = Papa.parse<string[]>(readFileSync(file, "utf8").replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data;
    const r = toLineItems(rows.slice(1), guessMapping(rows[0]));
    expect(r.rejected).toHaveLength(3);
    expect(r.stats.hasProducts && r.stats.hasRegion && r.stats.hasTime).toBe(true);
    expect(r.items.every((i) => checkItem(i) === null)).toBe(true);
  });
});
