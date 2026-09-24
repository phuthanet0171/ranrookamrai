// Old address of the shop page: the shop now lives on the home page.
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/shop";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ShopRedirect({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  redirect(isUuid(sp.shop) ? `/api/shops/select?id=${sp.shop}&next=/` : "/");
}
