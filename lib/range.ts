import type { LoadedBounds } from "./types";
import { addDays, isIsoDate } from "./format";
import { anchorDate } from "./data";

export const PRESETS = [
  { id: "7d", label: "7 วัน", days: 7 },
  { id: "30d", label: "30 วัน", days: 30 },
  { id: "90d", label: "90 วัน", days: 90 },
  { id: "365d", label: "1 ปี", days: 365 },
  { id: "all", label: "ทั้งหมด", days: null },
] as const;

export type ResolvedRange = { start: string; end: string; preset: string; anchor: string };

const clamp = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);

export function resolveRange(params: { range?: string; start?: string; end?: string }, b: LoadedBounds): ResolvedRange {
  const anchor = anchorDate(b);

  if (isIsoDate(params.start) && isIsoDate(params.end)) {
    let s = clamp(params.start, b.min_date, b.max_date);
    let e = clamp(params.end, b.min_date, b.max_date);
    if (s > e) [s, e] = [e, s];
    return { start: s, end: e, preset: "custom", anchor };
  }
  const preset = PRESETS.find((p) => p.id === params.range) ?? PRESETS[1];
  const start = preset.days === null ? b.min_date : clamp(addDays(anchor, -(preset.days - 1)), b.min_date, anchor);
  return { start, end: anchor, preset: preset.id, anchor };
}
