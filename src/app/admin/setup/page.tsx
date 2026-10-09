import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateAdminForm } from "@/app/admin/admin-accounts";
import { AuthShell } from "@/components/auth-shell";
import { db } from "@/lib/db";

export const metadata = { title: "Create admin" };

// The admin count changes at runtime, so this must not be frozen during `next build`.
export const dynamic = "force-dynamic";

export default async function AdminSetupPage() {
  const admins = await db.user.count({ where: { role: "ADMIN" } });
  if (admins > 0) redirect("/admin");

  return (
    <AuthShell
      title="Create an admin"
      footer={
        <>
          After this,{" "}
          <Link className="underline" href="/login">
            sign in
          </Link>{" "}
          and open the admin area.
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">There is no admin account yet. Choose a new email and password. Nothing is read from the seed settings.</p>
      <CreateAdminForm first />
    </AuthShell>
  );
}
