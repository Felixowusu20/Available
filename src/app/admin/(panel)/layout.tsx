import { signOut } from "@/auth";
import { AdminSidebar } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/guards";

// The admin console is its own site. It does not use the student navigation.
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[16.5rem_minmax(0,1fr)]">
      <AdminSidebar
        email={user.email}
        signOutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
