import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/practice/http";

// A small, careful client for the two Paystack calls we need, plus the webhook signature check.
// The secret key is read from the environment and is never logged, returned or put in a URL.

const BASE = "https://api.paystack.co";
type FetchLike = typeof fetch;

/** The part of a Paystack transaction we use. Amounts are in the smallest unit (pesewas). */
export type ChargeData = {
  id: number;
  reference: string;
  status: string; // "success", "failed", "abandoned", ...
  amount: number;
  currency: string;
  channel?: string | null;
  fees?: number | null;
  paid_at?: string | null;
};

export function paystackMode(secret = env().PAYSTACK_SECRET_KEY): "test" | "live" | null {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return null;
}

/** Real charges are allowed for the live key stored on Vercel production, or when PAYSTACK_ALLOW_LIVE is set. */
export function livePaymentsAllowed(opts?: { secret?: string; allowLive?: boolean; vercelEnv?: string | undefined }): boolean {
  const secret = opts?.secret ?? env().PAYSTACK_SECRET_KEY;
  if (paystackMode(secret) !== "live") return true;
  const allowLive = opts?.allowLive ?? env().PAYSTACK_ALLOW_LIVE;
  const vercelEnv = opts && "vercelEnv" in opts ? opts.vercelEnv : process.env.VERCEL_ENV;
  return allowLive || vercelEnv === "production";
}

function secretKey(): string {
  const key = env().PAYSTACK_SECRET_KEY;
  if (!key) throw new ServiceError(503, "Payments are not switched on yet.");
  if (!livePaymentsAllowed({ secret: key })) {
    throw new ServiceError(503, "A live Paystack key is set but live payments are not allowed yet (PAYSTACK_ALLOW_LIVE).");
  }
  return key;
}

/**
 * Paystack signs every webhook with HMAC-SHA512 of the exact request body, using the secret key, and sends the
 * hex digest in `x-paystack-signature`. We compare in constant time. Anything else is rejected.
 */
export function verifySignature(rawBody: string, signature: string | null, secret = env().PAYSTACK_SECRET_KEY): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function call<T>(path: string, init: RequestInit, fetchImpl: FetchLike): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError(502, "Could not reach Paystack. Please try again in a moment.");
  }
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !body?.status || body.data === undefined) throw new ServiceError(502, "Paystack could not start the payment. Please try again.");
  return body.data;
}

export async function initializeTransaction(
  args: { email: string; amountPesewas: number; reference: string; callbackUrl: string; metadata: Record<string, string> },
  fetchImpl: FetchLike = fetch,
): Promise<{ authorizationUrl: string }> {
  const data = await call<{ authorization_url: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: args.email,
        amount: args.amountPesewas,
        currency: "GHS",
        reference: args.reference,
        callback_url: args.callbackUrl,
        channels: ["mobile_money", "card"],
        metadata: args.metadata,
      }),
    },
    fetchImpl,
  );
  if (data.reference !== args.reference || !data.authorization_url.startsWith("https://")) {
    throw new ServiceError(502, "Paystack returned an unexpected answer. Please try again.");
  }
  return { authorizationUrl: data.authorization_url };
}

/** Asks Paystack (server to server) what happened to a payment. Used to recover from a lost webhook. */
export async function verifyTransaction(reference: string, fetchImpl: FetchLike = fetch): Promise<ChargeData> {
  return call<ChargeData>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }, fetchImpl);
}
