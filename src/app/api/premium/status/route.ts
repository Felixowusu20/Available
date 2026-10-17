import { db } from "@/lib/db";
import { paymentState } from "@/lib/premium/status";
import { noStore, userRoute } from "@/lib/practice/route";

// What the "waiting for confirmation" screen asks every few seconds. It only reads: premium appears when
// Paystack's webhook has been verified, never because this page was visited.
export const GET = userRoute(async (user, req) => {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  const payment = await db.payment.findFirst({ where: { reference, userId: user.id }, select: { status: true, problem: true, problemHandledAt: true } });
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  return Response.json({ state: paymentState(payment, user.premium) }, { headers: noStore });
});
