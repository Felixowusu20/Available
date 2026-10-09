import { signOut } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { requireUser } from "@/lib/guards";

// Everything under (app) requires a signed-in user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <AppNav
        name={user.name}
        signOutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      {children}
    </>
  );
}
