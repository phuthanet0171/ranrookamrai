// POST /api/notifications { shop_id } -> mark every notification of the shop as read (owner only)
import { isOwner } from "@/lib/auth";
import { isUuid } from "@/lib/shop";
import { update } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { shop_id?: unknown };
  if (!isUuid(body.shop_id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  await update("notifications", `shop_id=eq.${body.shop_id}&read_at=is.null`, { read_at: new Date().toISOString() });
  return Response.json({ ok: true });
}
