// Import sales from the "นำเข้าข้อมูล" page, in batches (see 004_import_batches.sql):
//   GET  /api/import                                   -> { needsPassword, ready, ... }
//   POST { action: "begin",  meta, password }          -> { batch_id }
//   POST { action: "chunk",  batch_id, items, password } (repeat; retries are harmless)
//   POST { action: "commit", batch_id, password }      -> { inserted_rows, skipped_rows, bounds }
//   POST { action: "abort",  batch_id, password }
// Rows wait in a staging table; commit swaps them in with one transaction, so a failed or
// half-finished import never deletes or overwrites the data that is already there.
// Protected by ADMIN_PASSWORD. On a local dev server (npm run dev) it may be left empty.
import { timingSafeEqual } from "node:crypto";
import { isOwner } from "@/lib/auth";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { checkItem } from "@/lib/importer";
import { blocked, clientIp, hit, tooMany } from "@/lib/ratelimit";
import { startRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// wrong passwords are limited hard; a big file is ~20 chunks, so allow plenty of good calls
const BAD_PASSWORD = { max: 8, windowMs: 15 * 60_000 };
const CALLS = { max: 400, windowMs: 10 * 60_000 };
const MAX_ITEMS = 5000;
const MAX_ROWS = 300_000;
const CURRENCIES = new Set(["THB", "BRL", "USD", "EUR", "JPY", "GBP"]);

function needsPassword(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) || process.env.NODE_ENV === "production";
}

function passwordOk(given: unknown): boolean {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return process.env.NODE_ENV !== "production";   // local dev without a password
  if (typeof given !== "string") return false;
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const batchId = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

export async function GET() {
  let ready = false;
  if (supabaseConfigured()) {
    const b = await rpc<Record<string, unknown>>("data_bounds").catch(() => null);
    ready = Boolean(b && "has_order_ids" in b);                 // added by migration 004
  }
  return Response.json({
    needsPassword: needsPassword() && !(await isOwner()),
    passwordConfigured: Boolean(process.env.ADMIN_PASSWORD),
    production: process.env.NODE_ENV === "production",
    configured: supabaseConfigured(),
    ready,
  });
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) return bad("ยังไม่ได้ตั้งค่า Supabase", 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("ข้อมูลที่ส่งมาต้องเป็น JSON");
  }
  const ip = clientIp(req);
  const wait = hit(`import:${ip}`, CALLS);
  if (wait) return tooMany(wait, "นำเข้าข้อมูล");
  // locked out after too many wrong passwords - even a correct one is refused until the window passes
  const lock = blocked(`import-bad:${ip}`, BAD_PASSWORD);
  if (lock) return tooMany(lock, "ใส่รหัสผ่านผิด");
  if (!(await isOwner()) && !passwordOk(body.password)) {
    hit(`import-bad:${ip}`, BAD_PASSWORD);
    return bad(process.env.ADMIN_PASSWORD
      ? "รหัสผ่านผู้ดูแลไม่ถูกต้อง"
      : "เว็บที่ deploy แล้วต้องตั้งค่า ADMIN_PASSWORD ก่อนจึงจะนำเข้าข้อมูลได้", 401);
  }

  try {
    switch (body.action) {
      case "begin": {
        const m = (body.meta ?? {}) as Record<string, unknown>;
        const expected = m.expected_rows;
        if (m.mode !== "replace" && m.mode !== "append") return bad("mode ต้องเป็น replace หรือ append");
        if (!Number.isInteger(expected) || (expected as number) < 1 || (expected as number) > MAX_ROWS) {
          return bad(`จำนวนแถวต้องอยู่ระหว่าง 1–${MAX_ROWS}`);
        }
        const id = await rpc<number>("import_begin", {
          p_meta: {
            file_name: text(m.file_name, 200),
            mode: m.mode,
            expected_rows: expected,
            has_order_ids: m.has_order_ids === true,
            has_customer_ids: m.has_customer_ids === true,
            has_quantity: m.has_quantity === true,
            currency: typeof m.currency === "string" && CURRENCIES.has(m.currency) ? m.currency : null,
            region_label: text(m.region_label, 40),
            dataset_name: text(m.dataset_name, 60),
          },
        });
        return Response.json({ batch_id: id });
      }
      case "chunk": {
        const id = batchId(body.batch_id);
        const items = body.items;
        if (!id) return bad("batch_id ไม่ถูกต้อง");
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
          return bad(`ส่งข้อมูลได้ครั้งละ 1–${MAX_ITEMS} แถว`);
        }
        for (let i = 0; i < items.length; i++) {
          const field = checkItem(items[i]);
          if (field) return bad(`แถวที่ ${i + 1} ในชุดนี้ไม่ถูกต้อง (${field})`);
        }
        const n = await rpc<number>("import_stage", { p_batch: id, p_rows: items });
        return Response.json({ staged: n });
      }
      case "commit": {
        const id = batchId(body.batch_id);
        if (!id) return bad("batch_id ไม่ถูกต้อง");
        const run = startRun("import", "manual", { title: `นำเข้าชุดที่ ${id}` });
        try {
          const res = await run.step("SQL import_commit (transaction)", () =>
            rpc<{ inserted_rows: number; skipped_rows: number }>("import_commit", { p_batch: id }),
            (r) => `เพิ่ม ${r.inserted_rows} แถว · ข้าม ${r.skipped_rows} แถว`);
          await run.finish("success", { output: res });
          return Response.json(res);
        } catch (e) {
          await run.finish("failed", { error: (e as Error).message });
          throw e;
        }
      }
      case "abort": {
        const id = batchId(body.batch_id);
        if (!id) return bad("batch_id ไม่ถูกต้อง");
        await rpc("import_abort", { p_batch: id });
        return Response.json({ ok: true });
      }
      default:
        return bad("action ต้องเป็น begin, chunk, commit หรือ abort");
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (/import_(begin|stage|commit)/.test(msg) && msg.includes("404")) {
      return bad("ยังไม่ได้รัน migration 004 (รัน python pipeline/migrate.py)", 500);
    }
    // Postgres RAISE messages come back inside the Supabase error JSON
    const raised = msg.match(/"message":"([^"]+)"/)?.[1];
    return bad(raised ?? msg, 500);
  }
}
