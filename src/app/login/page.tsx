import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getCurrentUser } from "@/lib/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell
      title="Sign in"
      footer={
        <div className="space-y-1">
          <div>
            <Link className="underline" href="/forgot-password">
              Forgot password?
            </Link>
          </div>
          <div>
            New here?{" "}
            <Link className="underline" href="/signup">
              Create an account
            </Link>
          </div>
        </div>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
