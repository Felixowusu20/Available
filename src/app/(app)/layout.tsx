import Link from "next/link";
import { signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/guards";

// Everything under (app) requires a signed-in user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="border-b border-line bg-card">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm" aria-label="Main">
          <Link href="/dashboard" className="mr-2 text-base font-bold text-accent">
            MDC Practice
          </Link>
          <Link href="/dashboard" className="py-1 hover:underline">
            Dashboard
          </Link>
          <Link href="/practice" className="py-1 hover:underline">
            Practice
          </Link>
          {user.role === "ADMIN" && (
            <Link href="/admin" className="py-1 hover:underline">
              Admin
            </Link>
          )}
          <span className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="btn btn-ghost !min-h-9 !px-3 !py-1 text-sm">Sign out</button>
            </form>
          </span>
        </nav>
      </header>
      {children}
    </>
  );
}
