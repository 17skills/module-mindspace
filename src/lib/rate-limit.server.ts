// Einfache Begrenzung der Aufrufe pro Zeitfenster für öffentliche Endpunkte.
// Läuft im Speicher der Worker-Instanz: schützt gegen Massenabfragen und
// Rateversuche, ohne zusätzliche Datenbankschreibvorgänge.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

export type RateLimitResult = { ok: boolean; retryAfter: number };

/** Erlaubt `limit` Aufrufe je `windowMs` pro Schlüssel. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size > MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Anonymer Aufruferschlüssel: gehashte IP, damit keine Klartext-IP gespeichert wird. */
export async function callerKey(request: Request, salt = "scopebuilder"): Promise<string> {
  const raw =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const data = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Wirft eine sprechende Fehlermeldung, wenn das Limit überschritten ist. */
export function assertRate(key: string, limit: number, windowMs: number) {
  const result = rateLimit(key, limit, windowMs);
  if (!result.ok) {
    throw new Error(
      `Zu viele Anfragen. Bitte in ${result.retryAfter} Sekunden erneut versuchen.`,
    );
  }
}
