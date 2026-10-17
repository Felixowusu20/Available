"use client";

import { useState } from "react";

export function UnlockButton({ priceLabel }: { priceLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/premium/checkout", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data?.error ?? "Could not start the payment.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url); // Paystack's own page: Mobile Money approval happens there
    } catch {
      setError("Network problem. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}
      <button className="btn w-full sm:w-auto" onClick={unlock} disabled={busy}>
        {busy ? "Opening Paystack…" : `Unlock premium for ${priceLabel}`}
      </button>
      <p className="text-xs text-muted">You pay once, on Paystack&apos;s secure page, with Mobile Money or a card. We never see your card number or Mobile Money PIN.</p>
    </div>
  );
}
