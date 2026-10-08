import { AuthShell } from "@/components/auth-shell";
import { VerifyButton } from "./verify-button";

export const metadata = { title: "Verify email" };

// The token is only consumed after the user presses the button (POST), so link scanners can't burn it.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Verify your email">
      {token ? <VerifyButton token={token} /> : <p className="text-bad">This link is missing its token.</p>}
    </AuthShell>
  );
}
