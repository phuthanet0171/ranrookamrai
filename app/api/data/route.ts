// DELETE /api/data  -> removes every imported sales file (the /analytics data).
// Shops and daily entries are not touched. Owner only.
import { isOwner } from "@/lib/auth";
import { rpc, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function DELETE() {
  if (!supabaseConfigured()) return Response.json({ error: "ยังไม่ได้ตั้งค่า Supabase" }, { status: 500 });
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  try {
    return Response.json(await rpc<{ orders_removed: number }>("clear_imported_data"));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("clear_imported_data")) {
      return Response.json({ error: "ต้องรัน migration 008 ก่อน: python pipeline\migrate.py 008_production" }, { status: 500 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
