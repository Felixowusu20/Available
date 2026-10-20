"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data: res.ok ? data : { error: data?.issues?.[0]?.message ?? data?.error ?? "Failed" } };
  } catch {
    return { ok: false, data: { error: "Network problem. Try again." } };
  }
}

const OUTCOME_TEXT: Record<string, string> = {
  granted: "Confirmed: premium was unlocked.",
  "already-processed": "Already confirmed earlier. Nothing changed.",
  flagged: "Paystack reports a payment, but it needs a person to look at it (see the note on the payment).",
  "not-successful": "Paystack says this payment did not go through.",
  "unknown-reference": "Paystack does not know this reference.",
};

function ActionButton({ label, busyLabel, danger = false, onRun }: { label: string; busyLabel?: string; danger?: boolean; onRun: () => Promise<string | null> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className={`btn btn-ghost !min-h-9 !px-3 !py-1 text-sm ${danger ? "!text-bad" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          setMsg(await onRun());
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? (busyLabel ?? "Working…") : label}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}

export function RecheckButton({ reference }: { reference: string }) {
  return (
    <ActionButton
      label="Re-check with Paystack"
      busyLabel="Asking Paystack…"
      onRun={async () => {
        const r = await send("/api/admin/premium/recheck", { reference });
        return r.ok ? (OUTCOME_TEXT[String(r.data.outcome)] ?? String(r.data.outcome)) : String(r.data.error);
      }}
    />
  );
}

export function HandledButton({ paymentId }: { paymentId: string }) {
  return (
    <ActionButton
      label="Mark as handled"
      onRun={async () => {
        const r = await send(`/api/admin/premium/handled/${paymentId}`);
        return r.ok ? null : String(r.data.error);
      }}
    />
  );
}

export function RevokeButton({ userId }: { userId: string }) {
  return (
    <ActionButton
      label="Remove premium"
      danger
      onRun={async () => {
        if (!confirm("Remove premium from this account? (If they paid, refund them in the Paystack dashboard.)")) return null;
        const r = await send("/api/admin/premium/revoke", { userId });
        return r.ok ? null : String(r.data.error);
      }}
    />
  );
}

export function GrantForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await send("/api/admin/premium/grant", { email });
        setMsg(r.ok ? { ok: true, text: "Premium granted." } : { ok: false, text: String(r.data.error) });
        if (r.ok) setEmail("");
        setBusy(false);
        router.refresh();
      }}
    >
      <h2 className="text-lg font-semibold">Give premium for free</h2>
      <p className="text-sm text-muted">For testers, a promotion, or someone who paid by another route. They need an account already.</p>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Their account email</span>
        <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>
          {msg.text}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? "Saving…" : "Grant premium"}
      </button>
    </form>
  );
}
