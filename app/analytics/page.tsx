import type { DashboardData } from "@/lib/types";
import { rpc, supabaseConfigured } from "@/lib/supabase";
import { hasData, loadBounds } from "@/lib/data";
import { resolveRange, type ResolvedRange } from "@/lib/range";
import Dashboard from "@/components/Dashboard";
import { EmptyNotice, ErrorNotice, SetupNotice } from "@/components/Notice";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  let data: DashboardData;
  let range: ResolvedRange;
  const bounds = await loadBounds().catch((e: Error) => e);
  if (bounds instanceof Error) return <ErrorNotice message={bounds.message} />;
  if (!hasData(bounds)) return <EmptyNotice />;
  try {
    range = resolveRange({ range: one("range"), start: one("start"), end: one("end") }, bounds);
    data = await rpc<DashboardData>("dashboard_data", { p_start: range.start, p_end: range.end });
  } catch (e) {
    return <ErrorNotice message={(e as Error).message} />;
  }
  return <Dashboard data={data} bounds={bounds} range={range} />;
}
