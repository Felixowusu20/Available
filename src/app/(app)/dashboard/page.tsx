import { requireUser } from "@/lib/guards";
import { signOut } from "@/auth";

export const metadata = { title: "Dashboard" };

// Placeholder: the real dashboard arrives in phase 3.
export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Welcome{user.name ? `, ${user.name}` : ""}</h1>
      <p className="mt-2 text-muted">Practice features are coming in the next phase.</p>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="btn btn-ghost">Sign out</button>
      </form>
    </main>
  );
}
