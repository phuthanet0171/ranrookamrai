// GET /api/shops/select?id=<shop>&next=/record  -> remember the shop, go back to the page
import { NextResponse } from "next/server";
import { SHOP_COOKIE } from "@/lib/current";
import { isUuid } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, url.origin));
  if (isUuid(id)) {
    res.cookies.set(SHOP_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}
