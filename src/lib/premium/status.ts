export type PaymentState = "PAID" | "WAITING" | "FAILED" | "PROBLEM" | "REFUNDED";

/**
 * What a student is told about a payment, worked out only from what is already in the database. The page and its
 * polling endpoint both use this, so they can never disagree. `premium` is whether the account is unlocked now.
 */
export function paymentState(p: { status: "PENDING" | "SUCCESS" | "FAILED"; problem: string | null; problemHandledAt: Date | null }, premium: boolean): PaymentState {
  if (p.problem && !p.problemHandledAt) return "PROBLEM";
  if (p.status === "FAILED") return "FAILED";
  if (p.status === "SUCCESS") return premium ? "PAID" : "REFUNDED"; // paid, but premium has since been taken away
  return "WAITING";
}
