import { signOut } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { requireUser } from "@/lib/guards";
import { hasPremium } from "@/lib/premium/access";
import { settleRecentPayment } from "@/lib/premium/settle";

// Everything under (app) requires a signed-in user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.premium) await settleRecentPayment(user.id);
  const premium = user.premium || (await hasPremium(user.id));
  return (
    <>
      <AppNav
        name={user.name}
        premium={premium}
        signOutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      {children}
    </>
  );
}
