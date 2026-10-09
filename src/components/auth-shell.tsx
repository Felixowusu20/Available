import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="grid h-dvh overflow-hidden lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-accent p-10 text-accent-fg lg:flex">
        <Link href="/" className="inline-flex w-fit items-center gap-2 text-lg font-bold">
          <span className="grid size-9 place-items-center rounded-lg bg-accent-fg text-sm text-accent">A</span>
          Available
        </Link>
        <div>
          <p className="text-sm font-semibold opacity-80">Ghana MDC licensure</p>
          <h2 className="mt-2 max-w-sm text-3xl font-bold leading-tight">Practice for the exam, in one place.</h2>
          <p className="mt-3 max-w-sm text-sm opacity-80">Timed mocks and topic practice, with an explanation after every question.</p>
        </div>
        <p className="text-sm opacity-70">Students only see published questions.</p>
      </section>

      <section className="relative flex min-h-0 flex-col overflow-y-auto px-5 py-5 sm:px-8">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <Link href="/" className="mb-5 inline-flex w-fit items-center gap-2 font-bold lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-accent-fg">A</span>
            Available
          </Link>
          <div className="card p-5">
            <h1 className="mb-4 text-xl font-semibold">{title}</h1>
            {children}
          </div>
          {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
