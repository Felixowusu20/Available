"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PaymentState as State } from "@/lib/premium/status";

const MESSAGE: Record<State, { tone: string; title: string; body: string }> = {
  PAID: { tone: "bg-ok-bg text-ok", title: "Premium is unlocked", body: "Section practice, the questions-left counters and priority questions are now yours." },
  WAITING: { tone: "bg-warn-bg text-warn", title: "Waiting for Paystack to confirm your payment…", body: "As soon as the money leaves your account, this page checks with Paystack and unlocks premium. You do not need to pay again, and an admin does not have to approve it." },
  FAILED: { tone: "bg-bad-bg text-bad", title: "The payment did not go through", body: "You have not been charged for premium. You can try again." },
  REFUNDED: { tone: "bg-warn-bg text-warn", title: "This payment was refunded", body: "Premium was removed with the refund. You can unlock it again at any time." },
  PROBLEM: { tone: "bg-bad-bg text-bad", title: "We received your payment but need to check it", body: "Please message us with the reference below and we will sort it out quickly." },
};

/** Asks the server, which asks Paystack, until the payment is confirmed or clearly failed. */
export function StatusPoller({ reference, initial }: { reference: string; initial: State }) {
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    if (state !== "WAITING") return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const look = async () => {
      tries++;
      try {
        const res = await fetch(`/api/premium/status?reference=${encodeURIComponent(reference)}`, { cache: "no-store" });
        if (res.ok && !stopped) {
          const data = (await res.json()) as { state: State };
          if (data.state !== "WAITING") setState(data.state);
        }
      } catch {
        /* offline: try again on the next tick */
      }
      if (tries >= 45 && timer) clearInterval(timer);
    };
    timer = setInterval(() => void look(), 2000);
    void look();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [state, reference]);

  const m = MESSAGE[state];
  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-4 ${m.tone}`} role="status" aria-live="polite">
        <p className="font-semibold">{m.title}</p>
        <p className="mt-1 text-sm">{m.body}</p>
      </div>
      <p className="text-xs text-muted">
        Payment reference: <code>{reference}</code>
      </p>
      <div className="flex gap-3">
        {state === "PAID" ? (
          <Link href="/practice" className="btn">
            Go to Practice
          </Link>
        ) : (
          <Link href="/unlock" className="btn btn-ghost">
            Back to Premium
          </Link>
        )}
      </div>
    </div>
  );
}
