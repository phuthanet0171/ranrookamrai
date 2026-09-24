// Owner sign-in for the shop pages (a stop-gap until LINE Login in step 4).
// One password (ADMIN_PASSWORD) -> an httpOnly cookie holding an HMAC of it, so the
// password itself is never stored in the browser. `npm run dev` without a password: open.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "si_admin";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const token = (secret: string) => createHmac("sha256", secret).update("sales-insight-admin:v1").digest("hex");

export function authRequired(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) || process.env.NODE_ENV === "production";
}

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(given: unknown): boolean {
  const secret = process.env.ADMIN_PASSWORD;
  return Boolean(secret) && typeof given === "string" && same(secret!, given);
}

/** True when this request may see and change private shop data. */
export async function isOwner(): Promise<boolean> {
  if (!authRequired()) return true;
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;                        // deployed without a password: nobody is the owner
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return same(value, token(secret));
}

export async function signIn(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, token(process.env.ADMIN_PASSWORD!), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE,
  });
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
