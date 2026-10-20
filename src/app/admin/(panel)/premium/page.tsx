import { paystackEnabled } from "@/lib/env";
import { formatGhs } from "@/lib/money";
import { paystackMode } from "@/lib/paystack";
import { listPaymentIssues, listPremiumUsers } from "@/lib/premium/admin";
import { GrantForm, HandledButton, RecheckButton, RevokeButton } from "./actions";

export const metadata = { title: "Premium" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function PremiumAdminPage() {
  const [users, issues] = await Promise.all([listPremiumUsers(), listPaymentIssues()]);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Premium</h1>
        <p className="text-sm text-muted">
          Payments: {paystackEnabled() ? `Paystack is on (${paystackMode() ?? "unknown"} key).` : "Paystack is off (no PAYSTACK_SECRET_KEY set)."} Premium is set only by Paystack&apos;s confirmed webhook, by &quot;Re-check with Paystack&quot; below, or by you.
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
