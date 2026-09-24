// Minimal Supabase REST client (server-side only - never import this in a client component).
// Uses the service_role / secret key, which bypasses RLS, so it must stay on the server.

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New "sb_secret_..." keys are not JWTs: the apikey header alone is enough.
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`;
  return h;
}

function baseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set");
  return url.replace(/\/$/, "");
}

/** Call a Postgres function: POST /rest/v1/rpc/<fn> */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase rpc ${fn} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

/** Read a table: GET /rest/v1/<table>?<query>  (query is PostgREST syntax, already encoded) */
export async function select<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}?${query}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`Supabase select ${table} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
}

/** Insert rows and return them. */
export async function insert<T>(table: string, rows: Record<string, unknown>[]): Promise<T[]> {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(rows),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase insert ${table} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
}

/** Update rows matching a PostgREST filter, e.g. update("t", "id=eq.123", { a: 1 }). */
export async function update(table: string, filter: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}?${filter}`, {
    method: "PATCH", headers: { ...headers(), Prefer: "return=minimal" }, body: JSON.stringify(patch), cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase update ${table} failed (${res.status}): ${await res.text()}`);
}

/** Delete rows matching a PostgREST filter (the filter must not be empty). */
export async function remove(table: string, filter: string): Promise<void> {
  if (!filter) throw new Error("remove() needs a filter");
  const res = await fetch(`${baseUrl()}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`Supabase delete ${table} failed (${res.status}): ${await res.text()}`);
}

// ---- AI summary cache (table ai_insights) ----

export type CacheRow = { facts_hash: string; response: unknown };

export async function cacheGet(key: string): Promise<CacheRow | null> {
  try {
    const q = `cache_key=eq.${encodeURIComponent(key)}&select=facts_hash,response`;
    const res = await fetch(`${baseUrl()}/rest/v1/ai_insights?${q}`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as CacheRow[];
    return rows[0] ?? null;
  } catch {
    return null;                                  // cache problems never break the page
  }
}

export async function cachePut(key: string, factsHash: string, response: unknown): Promise<void> {
  if (!supabaseConfigured()) return;
  await fetch(`${baseUrl()}/rest/v1/ai_insights`, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ cache_key: key, facts_hash: factsHash, response, created_at: new Date().toISOString() }]),
    cache: "no-store",
  }).catch(() => undefined);
}
