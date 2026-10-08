import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { PostForm } from "@/components/auth-form";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      footer={
        <>
          Already registered?{" "}
          <Link className="underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <PostForm
        action="/api/account/signup"
        submitLabel="Create account"
        successMessage="Check your email for a verification link, then sign in. If you don't see it, check your spam folder."
        fields={[
          { name: "name", label: "Full name", autoComplete: "name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." },
        ]}
      />
    </AuthShell>
  );
}
