// POST /api/automations { shop_id, kind }  -> create a rule from its template (owner only)
import { isOwner } from "@/lib/auth";
import { RULE_KINDS, type RuleKind } from "@/lib/automations";
import { isUuid } from "@/lib/shop";
import { insert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isOwner())) return Response.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { shop_id?: unknown; kind?: unknown };
  if (!isUuid(body.shop_id)) return Response.json({ error: "รหัสร้านไม่ถูกต้อง" }, { status: 400 });
  if (typeof body.kind !== "string" || !(body.kind in RULE_KINDS)) return Response.json({ error: "ประเภทกฎไม่ถูกต้อง" }, { status: 400 });
  const t = RULE_KINDS[body.kind as RuleKind];
  try {
    const [rule] = await insert<{ id: string }>("automation_rules", [{
      shop_id: body.shop_id, kind: body.kind, run_at: t.run_at, days: t.days, threshold: t.threshold ?? null, channel: "web",
    }]);
    return Response.json({ id: rule.id });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg.includes("automation_rules") && msg.includes("404")
      ? "ยังไม่ได้รัน migration 007 (python pipeline\\migrate.py 007_automations)" : msg }, { status: 500 });
  }
}
