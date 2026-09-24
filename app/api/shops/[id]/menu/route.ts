// POST /api/shops/:id/menu { items: [{ id?, name, category, unit, price, unit_cost, aliases, active }] }
import { isOwner } from "@/lib/auth";
import { rpc } from "@/lib/supabase";
import { checkMenu, isUuid } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  const bad = checkMenu(body.items);
  if (bad) return Response.json({ error: bad }, { status: 400 });
  try {
    const n = await rpc<number>("shop_menu_upsert", { p_shop: id, p_items: body.items });
    return Response.json({ saved: n });
  } catch (e) {
    return Response.json({ error: (e as Error).message.match(/"message":"([^"]+)"/)?.[1] ?? (e as Error).message }, { status: 500 });
  }
}
