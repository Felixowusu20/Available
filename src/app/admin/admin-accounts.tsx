"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AdminRow = { id: string; email: string; name: string | null };

export function CreateAdminForm({ first }: { first?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the admin.");
      if (data.first) {
        setCreated(data.email);
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      setCreated(data.email);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the admin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/admin/admins" onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
        <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}
      {created && first && (
        <p role="status" className="rounded-lg bg-ok-bg p-3 text-sm text-ok">
          Admin {created} is ready. <a className="underline" href="/login">Sign in</a> with that email. The old seeded account is not required.
        </p>
      )}
      {created && !first && (
        <p role="status" className="rounded-lg bg-ok-bg p-3 text-sm text-ok">
          Added {created}.
        </p>
      )}
      <button className="btn w-full" type="submit" disabled={busy}>
        {busy ? "Saving…" : first ? "Create admin" : "Add admin"}
      </button>
    </form>
  );
}

export function AdminTeam({ admins, currentId }: { admins: AdminRow[]; currentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(admin: AdminRow) {
    const last = admins.length === 1;
    const message = last
      ? `Delete ${admin.email}? You will need to create a new admin before anyone can open this area again.`
      : `Delete admin ${admin.email}?`;
    if (!confirm(message)) return;
    setBusy(admin.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not delete that admin.");
      if (data.last) {
        window.location.href = "/admin/setup";
        return;
      }
      if (data.self) {
        window.location.href = "/login";
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that admin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line">
        {admins.map((admin) => (
          <li key={admin.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-medium">{admin.name || "Admin"}</span>
              <span className="block text-muted">{admin.email}</span>
              {admin.id === currentId && <span className="text-xs text-accent">Signed in</span>}
            </span>
            <button type="button" className="btn btn-ghost !min-h-9 !px-3 !py-1 text-sm !text-bad" disabled={busy === admin.id} onClick={() => remove(admin)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <CreateAdminForm />
    </div>
  );
}
