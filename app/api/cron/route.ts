// GET|POST /api/cron  - run every automation rule whose time has come (Asia/Bangkok).
// Call it every 5-15 minutes from anything: GitHub Actions (.github/workflows/cron.yml),
// Vercel Cron (web/vercel.json, sends "Authorization: Bearer $CRON_SECRET" by itself),
// n8n, or Supabase pg_cron. automation_claim() makes overlapping callers harmless.
import { timingSafeEqual } from "node:crypto";
import { executeRule, localNow, type Rule, type RuleResult } from "@/lib/automations";
import { currencySymbol } from "@/lib/format";
import { listShops } from "@/lib/shop";
import { rpc, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tick(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "ตั้งค่า CRON_SECRET ก่อน" }, { status: 500 });
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 500 });

  const now = new Date();
  const due = await rpc<Rule[]>("automation_due", { p_now: now.toISOString() });
  const shops = new Map((await listShops()).map((s) => [s.id, s]));
  const results: RuleResult[] = [];
  for (const rule of due) {
    const shop = shops.get(rule.shop_id);
    if (!shop) continue;
    results.push(await executeRule(rule, shop, currencySymbol(shop.currency), { trigger: "schedule", now }));
  }
  const failed = results.filter((r) => r.status === "failed").length;
  return Response.json({ now: localNow(now), due: due.length, failed, results }, { status: failed ? 500 : 200 });
}

export const GET = tick;
export const POST = tick;
