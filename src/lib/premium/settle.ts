import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { hasPremium } from "@/lib/premium/access";
import { applyCharge } from "@/lib/premium/confirm";
import { paymentState, type PaymentState } from "@/lib/premium/status";
import { verifyTransaction } from "@/lib/paystack";
import { ServiceError } from "@/lib/practice/http";

const fields = { status: true, problem: true, problemHandledAt: true } as const;

/**
 * Asks Paystack what happened to this student's own payment and opens premium when Paystack says the
 * money was taken. The browser never sends an amount: the answer comes from Paystack, and the same
 * checks as the webhook decide whether to unlock. Safe to call many times.
 */
export async function settleOwnPayment(userId: string, reference: string, fetchImpl: typeof fetch = fetch): Promise<PaymentState> {
  const payment = await db.payment.findFirst({ where: { reference, userId }, select: { id: true, ...fields } });
  if (!payment) throw new ServiceError(404, "Payment not found");

  if (payment.status === "PENDING" && !payment.problem) {
    try {
      const charge = await verifyTransaction(reference, fetchImpl);
      if (charge.reference === reference) await applyCharge(charge);
    } catch (err) {
      logger.warn({ reference, err: err instanceof Error ? err.message : "unknown" }, "could not confirm the payment with Paystack yet");
    }
  }

  const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: fields });
  return paymentState(fresh, await hasPremium(userId));
}

/** Confirms the student's newest unfinished payment from the last two days, if they have one. */
export async function settleRecentPayment(userId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const payment = await db.payment.findFirst({
    where: { userId, status: "PENDING", problem: null, createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    select: { reference: true },
  });
  if (payment) await settleOwnPayment(userId, payment.reference, fetchImpl);
}
