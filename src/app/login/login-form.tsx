"use client";

import { useActionState, useState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [resent, setResent] = useState(false);

  async function resend() {
    if (!state?.unverifiedEmail) return;
    await fetch("/api/account/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.unverifiedEmail }),
    }).catch(() => undefined);
    setResent(true);
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && (
        <div role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {state.error}
          {state.unverifiedEmail && (
            <div className="mt-2">
              {resent ? (
                "A new link has been sent."
              ) : (
                <button type="button" onClick={resend} className="underline">
                  Resend verification email
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button className="btn w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
