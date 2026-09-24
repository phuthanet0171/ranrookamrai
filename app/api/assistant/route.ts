// POST /api/assistant { question, scope: "dataset" | <shop uuid> } -> AgentAnswer
import { isOwner } from "@/lib/auth";
import { anchorDate, factContext, hasData, loadBounds } from "@/lib/data";
import { currencySymbol } from "@/lib/format";
import { gemini } from "@/lib/gemini";
import { runAgent, type AgentScope } from "@/lib/agent";
import { clientIp, hit, tooMany } from "@/lib/ratelimit";
import { startRun } from "@/lib/runs";
import { isUuid, listShops, todayBangkok } from "@/lib/shop";
import { supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_IP = { max: 15, windowMs: 10 * 60_000 };
const GLOBAL = { max: 150, windowMs: 60 * 60_000 };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (!supabaseConfigured()) return bad("ยังไม่ได้ตั้งค่า Supabase", 500);
  if (!process.env.GEMINI_API_KEY) return bad("ยังไม่ได้ตั้งค่า GEMINI_API_KEY", 500);
  const wait = hit(`assistant:${clientIp(req)}`, PER_IP) || hit("assistant:all", GLOBAL);
  if (wait) return tooMany(wait, "ถามผู้ช่วย");

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; scope?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 2 || question.length > 400) return bad("คำถามต้องยาว 2–400 ตัวอักษร");

  let scope: AgentScope;
  let shopId: string | null = null;
  try {
    if (body.scope === "dataset") {
      const b = await loadBounds();
      if (!hasData(b)) return bad("ยังไม่มีข้อมูลในชุดข้อมูลวิเคราะห์");
      scope = { kind: "dataset", bounds: b, ctx: factContext(b), today: anchorDate(b), name: b.dataset_name ?? "ชุดข้อมูลวิเคราะห์" };
    } else if (isUuid(body.scope)) {
      const shop = (await listShops()).find((s) => s.id === body.scope);
      if (!shop) return bad("ไม่พบร้าน", 404);
      if (!shop.is_demo && !(await isOwner())) return bad("กรุณาเข้าสู่ระบบก่อน", 401);
      shopId = shop.id;
      scope = { kind: "shop", shopId: shop.id, name: shop.name, sym: currencySymbol(shop.currency), today: todayBangkok() };
    } else {
      return bad("scope ไม่ถูกต้อง");
    }
  } catch (e) {
    return bad((e as Error).message, 500);
  }

  const run = startRun("assistant", "manual", { title: question, shopId });
  try {
    const answer = await runAgent(question, scope, { model: gemini, run });
    await run.finish(answer.source === "ai" ? "success" : "fallback",
      { output: { answer: answer.answer.slice(0, 1000), tools: answer.tools.map((t) => t.name) }, error: answer.note });
    return Response.json(answer);
  } catch (e) {
    await run.finish("failed", { error: (e as Error).message });
    return bad(`ผู้ช่วยตอบไม่สำเร็จ: ${(e as Error).message}`, 500);
  }
}
