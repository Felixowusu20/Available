"use client";

import Link from "next/link";
import { useState } from "react";

export function VerifyButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");

  async function verify() {
    setState("busy");
    try {
      const res = await fetch("/api/account/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(res.ok ? "ok" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "ok") {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-ok-bg p-3 text-ok">
          Email verified.
        </p>
        <Link href="/login" className="btn w-full">
          Continue to sign in
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted">Confirm that this is your email address.</p>
      {state === "error" && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          This link is invalid or has expired. Sign in to request a new one.
        </p>
      )}
      <button onClick={verify} disabled={state === "busy"} className="btn w-full">
        {state === "busy" ? "Verifying…" : "Verify my email"}
      </button>
    </div>
  );
}
