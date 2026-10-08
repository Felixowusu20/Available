import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PostForm } from "@/components/auth-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      footer={
        <Link className="underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      <PostForm
        action="/api/account/forgot-password"
        submitLabel="Send reset link"
        successMessage="If an account exists for that email, a reset link is on its way."
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      />
    </AuthShell>
  );
}
