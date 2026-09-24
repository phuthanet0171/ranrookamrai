// Small in-memory rate limiter (sliding window).
// Good enough for a portfolio app: on Vercel each server instance keeps its own
// counters, so the limit is per instance - it still stops a single visitor from
// burning the Gemini free-tier quota or brute-forcing the import password.

type Bucket = number[];
const buckets = new Map<string, Bucket>();

export type Limit = { max: number; windowMs: number };

/** Returns 0 when allowed, otherwise how many seconds to wait. */
export function hit(key: string, { max, windowMs }: Limit, now = Date.now()): number {
  const since = now - windowMs;
  const b = (buckets.get(key) ?? []).filter((t) => t > since);
  if (b.length >= max) {
    buckets.set(key, b);
    return Math.max(1, Math.ceil((b[0] + windowMs - now) / 1000));
  }
  b.push(now);
  buckets.set(key, b);
  if (buckets.size > 5000) {                       // keep memory bounded
    for (const [k, v] of buckets) if (!v.length || v[v.length - 1] <= since) buckets.delete(k);
  }
  return 0;
}

/** Like hit() but does not count this call: seconds to wait if the bucket is already full. */
export function blocked(key: string, { max, windowMs }: Limit, now = Date.now()): number {
  const b = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  return b.length >= max ? Math.max(1, Math.ceil((b[0] + windowMs - now) / 1000)) : 0;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim() || "local";
}

export function tooMany(waitSec: number, what: string) {
  return Response.json(
    { error: `${what}บ่อยเกินไป กรุณารออีก ${waitSec} วินาที` },
    { status: 429, headers: { "Retry-After": String(waitSec) } },
  );
}

/** Test helper */
export function resetLimits() {
  buckets.clear();
}
