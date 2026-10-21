import Link from "next/link";
import { paystackEnabled } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { formatGhs, PREMIUM_PRICE_PESEWAS } from "@/lib/money";
import { paystackMode } from "@/lib/paystack";
import { hasPremium, PREMIUM_FEATURES } from "@/lib/premium/access";
import { settleRecentPayment } from "@/lib/premium/settle";
import { UnlockButton } from "./unlock-button";

export const metadata = { title: "Unlock premium" };
export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  const user = await requireUser();
  if (!user.premium) await settleRecentPayment(user.id);
  const premium = user.premium || (await hasPremium(user.id));
  const price = formatGhs(PREMIUM_PRICE_PESEWAS);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Premium</h1>
      <p className="text-muted">One payment of {price}, for life. No subscription.</p>

      <ul className="card divide-y divide-line">
        {PREMIUM_FEATURES.map((f) => (
          <li key={f.title} className="p-4">
            <p className="font-semibold">{f.title}</p>
            <p className="text-sm text-muted">{f.text}</p>
          </li>
        ))}
      </ul>

      {premium ? (
        <p className="rounded-lg bg-ok-bg p-3 text-ok" role="status">
          {user.role === "ADMIN" ? "Admin accounts have every feature." : "You have premium. Everything above is unlocked."}{" "}
          <Link href="/practice" className="underline">
            Go to Practice
          </Link>
        </p>
      ) : !paystackEnabled() ? (
        <p className="rounded-lg bg-warn-bg p-3 text-warn" role="note">
          Premium ({price}) opens soon.
        </p>
      ) : (
        <>
          {paystackMode() === "test" && (
            <p className="rounded-lg bg-warn-bg p-3 text-sm text-warn" role="note">
              Test mode: payments here use Paystack&apos;s test environment, so no real money moves.
            </p>
          )}
          <UnlockButton priceLabel={price} />
        </>
      )}
    </main>
  );
}
