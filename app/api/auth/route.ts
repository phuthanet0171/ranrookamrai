// POST /api/auth { password }  -> sign in (sets an httpOnly cookie)
// DELETE /api/auth             -> sign out
import { passwordMatches, signIn, signOut } from "@/lib/auth";
import { blocked, clientIp, hit, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const BAD_PASSWORD = { max: 8, windowMs: 15 * 60_000 };

export async function POST(req: Request) {
  const ip = clientIp(req);
  const lock = blocked(`auth-bad:${ip}`, BAD_PASSWORD);
  if (lock) return tooMany(lock, "ใส่รหัสผ่านผิด");
  if (!process.env.ADMIN_PASSWORD) {
    return Response.json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้ง ADMIN_PASSWORD" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!passwordMatches(body.password)) {
    hit(`auth-bad:${ip}`, BAD_PASSWORD);
    return Response.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }
  await signIn();
  return Response.json({ ok: true });
}

export async function DELETE() {
  await signOut();
  return Response.json({ ok: true });
}
