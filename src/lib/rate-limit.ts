import { db } from "@/lib/db";

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

/**
 * Fixed-window limiter backed by Postgres (works across several app instances).
 * `key` should combine the action and the client, e.g. `login:ip:1.2.3.4`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0].count);

  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.01) {
    void db.rateLimit
      .deleteMany({ where: { windowStart: { lt: new Date(now - 24 * 3600 * 1000) } } })
      .catch(() => undefined);
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
  return { ok: count <= limit, retryAfterSeconds };
}

/**
 * Read-only check: is this key already over its limit in the current window? Does not count a hit.
 * Use with `rateLimit()` when only some outcomes (e.g. failed logins) should consume the allowance.
 */
export async function rateLimitPeek(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await db.rateLimit.findUnique({ where: { key_windowStart: { key, windowStart } }, select: { count: true } });
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
  return { ok: (row?.count ?? 0) < limit, retryAfterSeconds };
}

/**
 * Best-effort client IP behind a reverse proxy. The proxy MUST overwrite X-Forwarded-For with the
 * real client address (see DEPLOYMENT.md); otherwise a caller can spoof it and dodge rate limits.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
