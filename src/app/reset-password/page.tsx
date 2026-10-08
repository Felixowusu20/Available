import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PostForm } from "@/components/auth-form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link className="underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      {token ? (
        <PostForm
          action="/api/account/reset-password"
          submitLabel="Set new password"
          successMessage="Password updated. You can now sign in."
          hidden={{ token }}
          fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." }]}
        />
      ) : (
        <p className="text-bad">This link is missing its token. Request a new one.</p>
      )}
    </AuthShell>
  );
}
