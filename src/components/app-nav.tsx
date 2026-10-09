"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconName } from "@/components/icons";

const links: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/practice", label: "Practice", icon: "practice" },
];

export function AppNav({ name, signOutAction }: { name: string | null; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const first = name?.split(" ")[0];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
      <div className="h-1 bg-accent" />
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5">
        <Link href="/dashboard" className="inline-flex min-h-11 shrink-0 items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-accent-fg">A</span>
          Available
        </Link>
        <nav className="flex items-center gap-1 rounded-xl bg-bg p-1" aria-label="Main">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${active ? "bg-card text-accent shadow-sm" : "text-muted hover:text-fg"}`}
              >
                <Icon name={link.icon} className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {first && <span className="hidden px-2 text-sm text-muted sm:inline">{first}</span>}
          <ThemeToggle />
          <form action={signOutAction}>
            <button className="btn btn-ghost !min-h-11 !px-3 !py-1 text-sm" type="submit">
              <Icon name="logout" className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
