// Server-side helpers shared by pages and API routes.
import type { Bounds, LoadedBounds } from "./types";
import type { FactContext } from "./facts";
import { rpc } from "./supabase";
import { setCurrency } from "./format";

/** Reads data_bounds() and sets the currency used by every money() call in this request. */
export async function loadBounds(): Promise<Bounds> {
  const b = await rpc<Bounds>("data_bounds");
  setCurrency(b.currency ?? "BRL");
  return b;
}

export const hasData = (b: Bounds): b is LoadedBounds => Boolean(b.min_date && b.max_date);

export const factContext = (b: Bounds): FactContext => ({
  currency: b.currency ?? "BRL",
  region: b.region_label ?? "รัฐของลูกค้า",
  hasTime: b.has_time,
});

/** "Today" = the simulated date n8n moves forward each day, or the last date in the data. */
export function anchorDate(b: LoadedBounds): string {
  return b.sim_date && b.sim_date <= b.max_date && b.sim_date >= b.min_date ? b.sim_date : b.max_date;
}
