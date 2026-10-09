"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconName } from "@/components/icons";

const links: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: "/admin", label: "Overview", icon: "shield", exact: true },
  { href: "/admin/questions", label: "Question bank", icon: "bank" },
  { href: "/admin/import", label: "Import", icon: "upload" },
  { href: "/admin/ai", label: "AI review", icon: "spark" },
];

export function AdminSidebar({ email, signOutAction }: { email: string; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const drawerHidden = !desktop && !open;

  return (
    <div className="md:sticky md:top-0 md:z-30 md:h-dvh">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card/95 px-3 py-2 backdrop-blur md:hidden">
        <button type="button" className="btn btn-ghost !min-h-10 !px-3" aria-expanded={open} aria-controls="admin-sidebar" onClick={() => setOpen(true)}>
          <Icon name="menu" className="size-4" />
          <span className="sr-only">Open menu</span>
        </button>
        <Link href="/admin" className="inline-flex min-h-10 items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-accent-fg">A</span>
          Available
        </Link>
      </div>

      {open && <button type="button" className="fixed inset-0 z-40 bg-fg/40 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <aside
        id="admin-sidebar"
        aria-hidden={drawerHidden || undefined}
        {...(drawerHidden ? { inert: true } : {})}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-card shadow-xl transition-transform md:static md:h-full md:w-auto md:translate-x-0 md:border-r md:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <Link href="/admin" className="inline-flex min-h-11 items-center gap-2 font-bold">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-accent-fg">A</span>
            <span>Available</span>
          </Link>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">Admin</span>
          <button type="button" className="btn btn-ghost ml-auto !min-h-10 !px-2 md:!hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Icon name="close" className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Admin">
          {links.map((link) => {
            const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold ${active ? "bg-accent text-accent-fg" : "text-muted hover:bg-bg hover:text-fg"}`}
              >
                <Icon name={link.icon} className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-line p-3">
          <p className="truncate px-2 text-xs text-muted" title={email}>
            {email}
          </p>
          <Link href="/dashboard" className="btn btn-ghost w-full !justify-start">
            <Icon name="dashboard" className="size-4" />
            Student site
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={signOutAction} className="min-w-0 flex-1">
              <button className="btn btn-ghost w-full" type="submit">
                <Icon name="logout" className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
    </div>
  );
}
