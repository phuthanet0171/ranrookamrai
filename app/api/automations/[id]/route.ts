// PATCH  /api/automations/:id { enabled?, run_at?, days?, channel?, target?, threshold? }
// DELETE /api/automations/:id
// POST   /api/automations/:id { dryRun } -> run now (manual; does not use up today's scheduled run)
import { isOwner } from "@/lib/auth";
import { executeRule, type Rule } from "@/lib/automations";
import { currencySymbol } from "@/lib/format";
import { isUuid, listShops } from "@/lib/shop";
import { remove, select, update } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

async function guard(ctx: Ctx): Promise<string | Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("รหัสกฎไม่ถูกต้อง");
  if (!(await isOwner())) return bad("กรุณาเข้าสู่ระบบก่อน", 401);
  return id;
}

/** Only the fields the owner may change, checked. */
function checkPatch(b: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  if ("enabled" in b) {
    if (typeof b.enabled !== "boolean") return { error: "enabled ต้องเป็น true/false" };
    patch.enabled = b.enabled;
  }
  if ("run_at" in b) {
    if (typeof b.run_at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.run_at)) return { error: "เวลาต้องเป็นรูปแบบ HH:MM" };
    patch.run_at = b.run_at;
  }
  if ("days" in b) {
    const d = b.days;
    if (!Array.isArray(d) || d.length === 0 || d.some((x) => !Number.isInteger(x) || x < 1 || x > 7)) return { error: "ต้องเลือกอย่างน้อย 1 วัน" };
    patch.days = [...new Set(d as number[])].sort();
  }
  if ("channel" in b) {
    if (b.channel !== "web" && b.channel !== "discord") return { error: "ช่องทางไม่ถูกต้อง" };
    patch.channel = b.channel;
  }
  if ("target" in b) {
    if (b.target !== null && (typeof b.target !== "string" || !b.target.startsWith("https://discord.com/api/webhooks/") || b.target.length > 300)) {
      return { error: "Discord webhook URL ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/" };
    }
    patch.target = b.target;
  }
  if ("threshold" in b) {
    if (b.threshold !== null && (typeof b.threshold !== "number" || b.threshold < 0 || b.threshold > 1e7)) return { error: "เกณฑ์ไม่ถูกต้อง" };
    patch.threshold = b.threshold;
  }
  if (patch.channel === "discord" && !("target" in patch)) return { error: "ใส่ Discord webhook URL ด้วย" };
  return { patch };
}

export async function PATCH(req: Request, ctx: Ctx) {
  const id = await guard(ctx);
  if (typeof id !== "string") return id;
  const res = checkPatch((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if ("error" in res) return bad(res.error);
  try {
    await update("automation_rules", `id=eq.${id}`, res.patch);
    return Response.json({ ok: true });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await guard(ctx);
  if (typeof id !== "string") return id;
  await remove("automation_rules", `id=eq.${id}`);
  return Response.json({ ok: true });
}

export async function POST(req: Request, ctx: Ctx) {
  const id = await guard(ctx);
  if (typeof id !== "string") return id;
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  const [rule] = await select<Rule>("automation_rules", `id=eq.${id}&select=*`);
  if (!rule) return bad("ไม่พบกฎนี้", 404);
  const shop = (await listShops()).find((s) => s.id === rule.shop_id);
  if (!shop) return bad("ไม่พบร้าน", 404);
  const result = await executeRule(rule, shop, currencySymbol(shop.currency), { trigger: "manual", dryRun: body.dryRun === true });
  return Response.json(result);
}
