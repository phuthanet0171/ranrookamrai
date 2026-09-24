// Which shop the pages are about. Remembered in a cookie so every page (home, record,
// reports, assistant, settings) opens on the same shop without ?shop= in every link.
import { cookies } from "next/headers";
import { isOwner } from "./auth";
import { listShops, type Shop } from "./shop";

export const SHOP_COOKIE = "si_shop";

export type Current = { owner: boolean; shops: Shop[]; shop: Shop | null; ready: boolean };

/** ready = false when the shop tables do not exist yet (migration 005 not run). */
export async function currentShop(requested?: string | string[]): Promise<Current> {
  const owner = await isOwner();
  let shops: Shop[];
  try {
    shops = await listShops();
  } catch {
    return { owner, shops: [], shop: null, ready: false };
  }
  const visible = owner ? shops : [];
  const want = typeof requested === "string" ? requested : (await cookies()).get(SHOP_COOKIE)?.value;
  return { owner, shops: visible, shop: visible.find((s) => s.id === want) ?? visible[0] ?? null, ready: true };
}
