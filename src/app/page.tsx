import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser, homeFor } from "@/lib/guards";

const points: { icon: IconName; title: string; body: string }[] = [
  { icon: "practice", title: "Timed mocks", body: "Exam pace" },
  { icon: "bank", title: "By topic", body: "Drill a weak area" },
  { icon: "check", title: "Explained", body: "Every answer" },
];

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));
  return (
    <main className="grid h-dvh overflow-hidden md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="flex min-h-0 flex-col px-5 py-4 sm:px-8 md:px-12 md:py-8">
        <header className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-lg font-bold">
            <span className="grid size-9 place-items-center rounded-lg bg-accent text-sm text-accent-fg">A</span>
            Available
          </span>
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <p className="text-sm font-semibold text-accent">Ghana MDC licensure</p>
          <h1 className="mt-2 max-w-xl text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">Practice for the exam, in one place.</h1>
          <p className="mt-3 max-w-md text-sm text-muted sm:text-base">
            Timed mocks and topic practice, with an explanation after every question.
          </p>
          <div className="mt-6 flex max-w-md gap-3">
            <Link href="/signup" className="btn flex-1">
              Create account
            </Link>
            <Link href="/login" className="btn btn-ghost flex-1">
              Sign in
            </Link>
          </div>
        </div>

        <ul className="grid shrink-0 grid-cols-3 gap-2 border-t border-line pt-4">
          {points.map((point) => (
            <li key={point.title} className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                <Icon name={point.icon} className="size-4 shrink-0 text-accent" />
                <span>{point.title}</span>
              </p>
              <p className="mt-0.5 text-xs leading-tight text-muted">{point.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="hidden items-center justify-center bg-accent px-8 text-accent-fg md:flex" aria-hidden="true">
        <div className="w-full max-w-sm rounded-2xl bg-card p-5 text-fg shadow-xl">
          <p className="text-xs font-bold tracking-wide text-accent uppercase">Sample item</p>
          <p className="mt-2 font-semibold leading-snug">A licensure question appears here, with four choices.</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="rounded-lg border border-line px-3 py-2">A. First choice</li>
            <li className="rounded-lg border border-accent bg-accent/10 px-3 py-2 font-medium">B. The selected choice</li>
            <li className="rounded-lg border border-line px-3 py-2">C. Third choice</li>
            <li className="rounded-lg border border-line px-3 py-2">D. Fourth choice</li>
          </ul>
          <p className="mt-3 text-xs text-muted">The explanation opens after you answer.</p>
        </div>
      </section>
    </main>
  );
}
