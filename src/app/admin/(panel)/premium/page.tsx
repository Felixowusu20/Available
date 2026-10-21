import { paystackEnabled } from "@/lib/env";
import { formatGhs } from "@/lib/money";
import { paystackMode } from "@/lib/paystack";
import { listPaymentIssues, listPayments, listPremiumUsers, paymentSummary } from "@/lib/premium/admin";
import { GrantForm, HandledButton, RecheckButton, RevokeButton } from "./actions";

export const metadata = { title: "Premium" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL = { SUCCESS: "Paid", PENDING: "Waiting", FAILED: "Not paid" } as const;
const channelLabel = (channel: string | null) => (channel === "mobile_money" ? "Mobile Money" : channel === "card" ? "Card" : channel || "Not chosen yet");

export default async function PremiumAdminPage() {
  const [users, issues, payments, summary] = await Promise.all([listPremiumUsers(), listPaymentIssues(), listPayments(), paymentSummary()]);
  const totals = [
    { label: "Collected", value: formatGhs(summary.collected), note: `${summary.paidCount} paid` },
    { label: "Paystack fees", value: formatGhs(summary.fees), note: "Taken out of each GHS 10" },
    { label: "You keep", value: formatGhs(summary.net), note: "Collected minus fees" },
    { label: "Still open", value: String(summary.pendingCount + summary.failedCount), note: `${summary.pendingCount} waiting · ${summary.failedCount} not paid` },
  ];
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Premium</h1>
        <p className="text-sm text-muted">
          Payments: {paystackEnabled() ? `Paystack is on (${paystackMode() ?? "unknown"} key).` : "Paystack is off (no PAYSTACK_SECRET_KEY set)."} When Paystack confirms the money was taken, premium opens on its own. Re-check is only for a payment that stayed waiting.
        </p>
      </div>

      {(issues.problems.length > 0 || issues.pending.length > 0) && (
        <section className="card space-y-3 border-warn p-4" aria-label="Payments needing attention">
          <h2 className="text-lg font-semibold">Needs attention</h2>
          {issues.problems.map((p) => (
            <div key={p.id} className="space-y-1 rounded bg-warn-bg p-3 text-sm text-warn">
              <p>
                <strong>{p.user.email}</strong> · {formatGhs(p.amountPesewas)} · {when(p.createdAt)} · <code>{p.reference}</code>
              </p>
              <p>{p.problem}</p>
              <HandledButton paymentId={p.id} />
            </div>
          ))}
          {issues.pending.length > 0 && <p className="text-sm text-muted">Started but not confirmed after 10 minutes (the student may have given up, or the webhook was lost):</p>}
          {issues.pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-3 text-sm">
              <span>
                {p.user.email} · {formatGhs(p.amountPesewas)} · {when(p.createdAt)} · <code>{p.reference}</code>
              </span>
              <RecheckButton reference={p.reference} />
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3" aria-label="Payment record">
        <div>
          <h2 className="text-lg font-semibold">Payment record</h2>
          <p className="text-sm text-muted">Every checkout attempt. A student pays GHS 10, and Paystack&apos;s fee comes out of that.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {totals.map((t) => (
            <div key={t.label} className="card p-4">
              <p className="text-sm text-muted">{t.label}</p>
              <p className="mt-1 text-2xl font-bold">{t.value}</p>
              <p className="mt-1 text-xs text-muted">{t.note}</p>
            </div>
          ))}
        </div>
        <div className="card p-4">
          {payments.length === 0 && <p className="text-sm text-muted">No payments yet. A row appears when a student starts checkout.</p>}
          <ul className="divide-y divide-line">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium">{p.user.name || p.user.email}</p>
                  <p className="text-xs text-muted">
                    {p.user.email} · {channelLabel(p.channel)} · {when(p.paidAt ?? p.createdAt)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted">{p.reference}</p>
                  {p.problem && <p className="mt-1 text-xs text-warn">{p.problem}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatGhs(p.amountPesewas)}</p>
                  <p className={`text-xs ${p.status === "SUCCESS" ? "text-ok" : p.status === "FAILED" ? "text-bad" : "text-warn"}`}>{STATUS_LABEL[p.status]}</p>
                  {p.status === "SUCCESS" && <p className="text-xs text-muted">Fee {formatGhs(p.feePesewas ?? 0)}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <GrantForm />

      <section className="card p-4" aria-label="Accounts with premium">
        <h2 className="mb-2 text-lg font-semibold">Accounts with premium ({users.length})</h2>
        {users.length === 0 && <p className="text-sm text-muted">Nobody yet.</p>}
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{u.name || u.email}</span>
                <span className="block text-xs text-muted">
                  {u.email} · {u.premiumSource === "PAYMENT" ? "paid" : "given by an admin"} · {u.premiumAt ? when(u.premiumAt) : ""}
                </span>
              </span>
              <RevokeButton userId={u.id} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
