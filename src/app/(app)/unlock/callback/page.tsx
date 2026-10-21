import { notFound } from "next/navigation";
import { requireUser } from "@/lib/guards";
import { settleOwnPayment } from "@/lib/premium/settle";
import { ServiceError } from "@/lib/practice/http";
import { StatusPoller } from "./status-poller";

export const metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

// Where Paystack sends the student after paying. The reference only selects their own payment. Premium opens
// when Paystack's own record says the money was taken, not because this address was opened.
export default async function CallbackPage({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? "";
  const state = await settleOwnPayment(user.id, reference).catch((err: unknown) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Payment status</h1>
      <StatusPoller reference={reference} initial={state} />
    </main>
  );
}
