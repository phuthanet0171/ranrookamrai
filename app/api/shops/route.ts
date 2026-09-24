// POST /api/shops { name }  -> { id }     (owner only)
import { isOwner } from "@/lib/auth";
import { insert, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!supabaseConfigured()) return Response.json({ error: "ยังไม่ได้ตั้งค่า Supabase" }, { status: 500 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  try {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return Response.json({ error: "ชื่อร้านต้องมี 1–80 ตัวอักษร" }, { status: 400 });
    const [shop] = await insert<{ id: string }>("shops", [{ name }]);
    return Response.json({ id: shop.id });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("relation") || msg.includes("404")) {
      return Response.json({ error: "ยังไม่ได้รัน migration 005 (รัน python pipeline/migrate.py)" }, { status: 500 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
