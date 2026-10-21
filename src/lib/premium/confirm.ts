import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { estimateFee } from "@/lib/money";
import { verifySignature, type ChargeData } from "@/lib/paystack";

// The ONLY place a payment unlocks premium. It is reached after Paystack itself has confirmed the charge:
//   1. Paystack's signed webhook,
//   2. the student returning from checkout, which asks Paystack server to server (lib/premium/settle.ts),
//   3. an admin pressing "Re-check with Paystack".
// Nothing in the browser is trusted: the amount and currency still have to match what we charged.

export type ChargeOutcome = "granted" | "already-processed" | "flagged" | "not-successful" | "unknown-reference";

/** Applies a confirmed (or failed) charge. Safe to call any number of times, concurrently, for the same reference. */
export async function applyCharge(data: ChargeData): Promise<ChargeOutcome> {
  const payment = await db.payment.findUnique({ where: { reference: data.reference } });
  if (!payment) {
    logger.warn({ reference: data.reference }, "paystack charge for an unknown reference");
    return "unknown-reference";
  }
  if (data.status !== "success") {
    if (data.status === "failed") await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
    return "not-successful";
  }
  if (payment.status === "SUCCESS") return "already-processed";

  // The amount and currency must be what we asked for: paying less must never unlock anything.
  if (data.amount !== payment.amountPesewas || data.currency !== payment.currency) {
    await db.payment.updateMany({
      where: { id: payment.id, problem: null },
      data: { problem: `Paystack reports ${data.amount} ${data.currency}, but ${payment.amountPesewas} ${payment.currency} was expected. Nothing was unlocked.`, paystackId: String(data.id) },
    });
    return "flagged";
  }

  const fee = Math.min(payment.amountPesewas, data.fees ?? estimateFee(payment.amountPesewas));
  const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
  const confirmed = { status: "SUCCESS" as const, paystackId: String(data.id), channel: data.channel ?? null, feePesewas: fee, paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt };

  return db.$transaction(async (tx) => {
    // Claiming the payment is one atomic UPDATE: of two simultaneous deliveries exactly one gets count 1.
    const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: { not: "SUCCESS" } }, data: confirmed });
    if (claimed.count === 0) return "already-processed" as const;

    // Only an account that is not premium yet is unlocked (this also keeps an admin's grant and its date intact).
    const unlocked = await tx.user.updateMany({ where: { id: payment.userId, premiumAt: null }, data: { premiumAt: confirmed.paidAt, premiumSource: "PAYMENT" } });
    if (unlocked.count === 0) {
      await tx.payment.update({ where: { id: payment.id }, data: { problem: "The account already had premium when this payment arrived. Refund this payment." } });
      return "flagged" as const;
    }
    return "granted" as const;
  });
}

export type WebhookResult = { status: number; body: { ok: boolean; outcome?: ChargeOutcome; error?: string } };

/**
 * Handles one webhook delivery. `rawBody` must be the exact text Paystack sent (the signature is computed over it).
 * 401 for a bad signature (nothing is read or stored); 200 for anything handled or deliberately ignored; 500 if our
 * own database failed, so that Paystack tries again later.
 */
export async function handleWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  if (!verifySignature(rawBody, signature)) return { status: 401, body: { ok: false, error: "Bad signature" } };

  let event: { event?: string; data?: ChargeData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "Bad JSON" } };
  }
  if (event.event !== "charge.success" || !event.data || typeof event.data.reference !== "string") return { status: 200, body: { ok: true } };

  try {
    return { status: 200, body: { ok: true, outcome: await applyCharge(event.data) } };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "unknown", reference: event.data.reference }, "webhook processing failed");
    return { status: 500, body: { ok: false, error: "Try again later" } };
  }
}
