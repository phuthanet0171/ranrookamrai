// POST   /api/shops/:id/entries { date, entry: { sales, cash, transfer, expenses, note } } -> { id }
// DELETE /api/shops/:id/entries?entry=<uuid>   (void: excluded from the numbers, kept in history)
import { isOwner } from "@/lib/auth";
import { isIsoDate } from "@/lib/format";
import { rpc } from "@/lib/supabase";
import { checkEntry, isUuid } from "@/lib/shop";

export const dynamic = "force-dynamic";

const dbError = (e: unknown) =>
  Response.json({ error: (e as Error).message.match(/"message":"([^"]+)"/)?.[1] ?? (e as Error).message }, { status: 500 });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; entry?: unknown };
  if (!isIsoDate(body.date)) return Response.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  const bad = checkEntry(body.entry);
  if (bad) return Response.json({ error: bad }, { status: 400 });
  try {
    const entry = await rpc<string>("shop_record_day", {
      p_shop: id, p_date: body.date, p_entry: body.entry, p_source: "web", p_author: "เว็บ",
    });
    return Response.json({ id: entry });
  } catch (e) {
    return dbError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = new URL(req.url).searchParams.get("entry");
  if (!isUuid(id) || !isUuid(entry)) return Response.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    const ok = await rpc<boolean>("shop_void_entry", { p_shop: id, p_entry: entry });
    return ok ? Response.json({ ok }) : Response.json({ error: "ไม่พบรายการนี้ หรือยกเลิกไปแล้ว" }, { status: 404 });
  } catch (e) {
    return dbError(e);
  }
}
