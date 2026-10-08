import Link from "next/link";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-6 text-lg font-bold text-accent">
        MDC Practice
      </Link>
      <div className="card p-5">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
      {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
    </main>
  );
}
