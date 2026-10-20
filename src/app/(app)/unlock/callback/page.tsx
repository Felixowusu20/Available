import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { paymentState } from "@/lib/premium/status";
import { StatusPoller } from "./status-poller";

export const metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

// Where Paystack sends the student after paying. This page ONLY DISPLAYS what the database says. It reads nothing
// from the address except the reference, and it never unlocks anything: premium is set by the signature-checked
// webhook (or an admin's re-check), so visiting this address by hand proves nothing.
export default async function CallbackPage({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? "";
  const payment = reference ? await db.payment.findFirst({ where: { reference, userId: user.id }, select: { status: true, problem: true, problemHandledAt: true } }) : null;
  if (!payment) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Payment status</h1>
      <StatusPoller reference={reference} initial={paymentState(payment, user.premium)} />
    </main>
  );
}
