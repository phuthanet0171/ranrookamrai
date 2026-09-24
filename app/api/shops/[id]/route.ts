// DELETE /api/shops/:id { confirm: "<shop name>" }  -> deletes the shop and everything in it
// (menu, entries, rules, notifications - see 008_production.sql). Owner only; the name must
// be typed back so a stray tap can never do it.
import { isOwner } from "@/lib/auth";
import { remove, select } from "@/lib/supabase";
import { isUuid } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  try {
    const [shop] = await select<{ name: string }>("shops", `id=eq.${id}&select=name`);
    if (!shop) return Response.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
    if (typeof body.confirm !== "string" || body.confirm.trim() !== shop.name) {
      return Response.json({ error: "พิมพ์ชื่อร้านให้ตรงก่อนลบ" }, { status: 400 });
    }
    await remove("shops", `id=eq.${id}`);
    return Response.json({ deleted: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("foreign key")) {
      return Response.json({ error: "ต้องรัน migration 008 ก่อน: python pipeline\migrate.py 008_production" }, { status: 500 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
