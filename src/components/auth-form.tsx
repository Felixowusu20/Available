"use client";

import { useState } from "react";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  hint?: string;
};

/**
 * Small generic form that POSTs JSON to an endpoint. `onSuccess` returns the message shown
 * afterwards (or a redirect handled by the caller via `afterSuccess`).
 */
export function PostForm({
  action,
  fields,
  submitLabel,
  successMessage,
  hidden,
}: {
  action: string;
  fields: Field[];
  submitLabel: string;
  successMessage: string;
  hidden?: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = { ...hidden };
    for (const f of fields) body[f.name] = String(form.get(f.name) ?? "");
    try {
      const res = await fetch(action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message ?? data?.error ?? "Something went wrong. Please try again.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="rounded-lg bg-ok-bg p-3 text-ok">
        {successMessage}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="mb-1 block text-sm font-medium">
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            required
            className="input"
          />
          {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
        </div>
      ))}
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}
      <button className="btn w-full" disabled={busy}>
        {busy ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}
