// Real shop data is private: every page and API needs the owner cookie (lib/auth.ts),
// except sign-in itself and the machine endpoints that carry their own secret.
// `npm run dev` without ADMIN_PASSWORD stays open, same as isOwner().
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/auth", "/api/cron", "/api/report", "/manifest.webmanifest", "/icon.svg", "/apple-icon"];

async function expectedToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("sales-insight-admin:v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret && process.env.NODE_ENV !== "production") return NextResponse.next();
  const cookie = req.cookies.get("si_admin")?.value ?? "";
  if (secret && same(cookie, await expectedToken(secret))) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อน" }, { status: 401 });
  const login = new URL("/login", req.url);
  if (path !== "/") login.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next's own files and the downloadable templates
  matcher: ["/((?!_next/|favicon.ico|samples/).*)"],
};
