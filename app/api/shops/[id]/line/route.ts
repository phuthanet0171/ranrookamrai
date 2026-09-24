// POST   /api/shops/:id/line               -> { code }   6-digit code to send to the LINE bot (15 min)
// DELETE /api/shops/:id/line?user=<lineId> -> unlink one LINE user from the shop
import { isOwner } from "@/lib/auth";
import { remove, rpc } from "@/lib/supabase";
import { isUuid } from "@/lib/shop";

export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  const msg = (e as Error).message;
  return Response.json({ error: msg.includes("line_link") ? "ต้องรัน migration 009 ก่อน: python pipeline\migrate.py 009_line" : msg }, { status: 500 });
};

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    return Response.json({ code: await rpc<string>("line_link_create", { p_shop: id }) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = new URL(req.url).searchParams.get("user");
  if (!isUuid(id) || !user || !/^U[0-9a-f]{32}$/.test(user)) return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    await remove("line_links", `line_user_id=eq.${user}&shop_id=eq.${id}`);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
