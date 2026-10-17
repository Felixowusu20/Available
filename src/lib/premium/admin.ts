import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { applyCharge, type ChargeOutcome } from "@/lib/premium/confirm";
import { verifyTransaction } from "@/lib/paystack";
import { ServiceError } from "@/lib/practice/http";
import { emailSchema } from "@/lib/validation";

export const grantSchema = z.object({ email: emailSchema });

/** Gives premium for free (testers, a promotion, a refund-and-keep). Safe to repeat: the first date is kept. */
export async function grantPremium(adminId: string, email: string) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, premiumAt: true } });
  if (!user) throw new ServiceError(404, "There is no account with that email.");
  if (user.premiumAt) throw new ServiceError(409, "That account already has premium.");
  await db.user.update({ where: { id: user.id }, data: { premiumAt: new Date(), premiumSource: "ADMIN" } });
  logger.info({ adminId, userId: user.id }, "premium granted by admin");
}

/** Takes premium away (after a refund, or a mistake). The payment record is kept. */
export async function revokePremium(adminId: string, userId: string) {
  const res = await db.user.updateMany({ where: { id: userId, premiumAt: { not: null } }, data: { premiumAt: null, premiumSource: null } });
  if (res.count === 0) throw new ServiceError(404, "That account does not have premium.");
  logger.info({ adminId, userId }, "premium revoked by admin");
}

export function listPremiumUsers() {
  return db.user.findMany({ where: { premiumAt: { not: null } }, orderBy: { premiumAt: "desc" }, take: 200, select: { id: true, email: true, name: true, premiumAt: true, premiumSource: true } });
}

/** Payments an admin has to look at: flagged ones, and ones still unconfirmed after ten minutes. */
export async function listPaymentIssues(now = new Date()) {
  const stale = new Date(now.getTime() - 10 * 60 * 1000);
  const select = { id: true, reference: true, amountPesewas: true, problem: true, status: true, createdAt: true, user: { select: { email: true } } } as const;
  const [problems, pending] = await Promise.all([
    db.payment.findMany({ where: { problem: { not: null }, problemHandledAt: null }, orderBy: { createdAt: "desc" }, take: 50, select }),
    db.payment.findMany({ where: { status: "PENDING", problem: null, createdAt: { lt: stale, gt: new Date(now.getTime() - 48 * 3600 * 1000) } }, orderBy: { createdAt: "desc" }, take: 50, select }),
  ]);
  return { problems, pending };
}

export async function markProblemHandled(paymentId: string) {
  const res = await db.payment.updateMany({ where: { id: paymentId, problem: { not: null } }, data: { problemHandledAt: new Date() } });
  if (res.count === 0) throw new ServiceError(404, "No flagged payment found.");
}

/** Asks Paystack directly what happened to a payment and applies the answer exactly as the webhook would. */
export async function recheckPayment(reference: string, fetchImpl: typeof fetch = fetch): Promise<ChargeOutcome> {
  const payment = await db.payment.findUnique({ where: { reference }, select: { id: true } });
  if (!payment) throw new ServiceError(404, "No payment with that reference.");
  const charge = await verifyTransaction(reference, fetchImpl);
  if (charge.reference !== reference) throw new ServiceError(502, "Paystack answered about a different payment.");
  return applyCharge(charge);
}
