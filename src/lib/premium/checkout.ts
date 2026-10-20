import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { env, paystackEnabled } from "@/lib/env";
import { initializeTransaction } from "@/lib/paystack";
import { ServiceError } from "@/lib/practice/http";
import { rateLimit } from "@/lib/rate-limit";
import { hasPremium } from "@/lib/premium/access";

/** A payment reference: unique, unguessable, and recognisable in Paystack's dashboard. */
export const newReference = () => `AV-${randomBytes(12).toString("base64url")}`;

/**
 * Starts a payment: records a PENDING payment, asks Paystack for a checkout page and returns its address.
 * The price is set here on the server; the browser never sends an amount. Nothing is unlocked by this call.
 */
export async function startPremiumCheckout(user: { id: string; email: string }, opts: { fetchImpl?: typeof fetch } = {}) {
  if (!paystackEnabled()) throw new ServiceError(503, "Payments are not switched on yet.");
  const limit = await rateLimit(`premium-checkout:user:${user.id}`, 8, 10 * 60);
  if (!limit.ok) throw new ServiceError(429, "Too many attempts. Please wait a few minutes and try again.");
  if (await hasPremium(user.id)) throw new ServiceError(409, "You already have premium.");

  const amountPesewas = env().PREMIUM_PRICE_PESEWAS;
  const payment = await db.payment.create({ data: { reference: newReference(), userId: user.id, amountPesewas }, select: { id: true, reference: true } });
  try {
    const { authorizationUrl } = await initializeTransaction(
      {
        email: user.email,
        amountPesewas,
        reference: payment.reference,
        callbackUrl: `${env().APP_URL}/unlock/callback?reference=${encodeURIComponent(payment.reference)}`,
        metadata: { paymentId: payment.id, userId: user.id },
      },
      opts.fetchImpl,
    );
    return { url: authorizationUrl, reference: payment.reference };
  } catch (e) {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    throw e;
  }
}
