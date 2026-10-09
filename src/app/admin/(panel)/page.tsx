import Link from "next/link";
import { AdminTeam } from "@/app/admin/admin-accounts";
import { Icon, type IconName } from "@/components/icons";
import { statusCounts } from "@/lib/admin/questions";
import { requireAdmin } from "@/lib/guards";
import { aiEnabled } from "@/lib/env";
import { db } from "@/lib/db";

export const metadata = { title: "Admin" };

const steps = [
  { n: "1", title: "Add questions", body: "Write one, or import JSON or CSV. Everything starts as a draft. Students never see drafts." },
  { n: "2", title: "Tag them", body: "Set the section, discipline and subtopic. A question cannot be published until all three are filled in." },
  { n: "3", title: "Publish", body: "In the question bank, select the rows and choose Publish. Only published questions appear in practice." },
];

export default async function AdminHome() {
  const user = await requireAdmin();
  const [counts, pendingSuggestions, users, admins] = await Promise.all([
    statusCounts(),
    db.aiSuggestion.count({ where: { status: "PENDING" } }),
    db.user.count(),
    db.user.findMany({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true } }),
  ]);
  const tiles: { label: string; value: number; href: string; icon: IconName }[] = [
    { label: "Published", value: counts.PUBLISHED, href: "/admin/questions?status=PUBLISHED", icon: "check" },
    { label: "In review", value: counts.IN_REVIEW, href: "/admin/questions?status=IN_REVIEW", icon: "shield" },
    { label: "Drafts", value: counts.DRAFT, href: "/admin/questions?status=DRAFT", icon: "practice" },
    { label: "Untagged", value: counts.untagged, href: "/admin/questions?untagged=1", icon: "bank" },
    { label: "Retired", value: counts.RETIRED, href: "/admin/questions?status=RETIRED", icon: "logout" },
    { label: "AI to review", value: pendingSuggestions, href: "/admin/ai", icon: "spark" },
  ];
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="mt-1 text-sm text-muted">Put questions on the platform in three steps. Students only ever see published ones.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/questions/new" className="btn">
            <Icon name="plus" className="size-4" />
            New question
          </Link>
          <Link href="/admin/import" className="btn btn-ghost">
            <Icon name="upload" className="size-4" />
            Import
          </Link>
          <Link href="/admin/questions" className="btn btn-ghost">
            <Icon name="bank" className="size-4" />
            Question bank
          </Link>
        </div>
      </div>

      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <li key={step.n} className="card p-4">
            <p className="text-sm font-bold text-accent">Step {step.n}</p>
            <h2 className="mt-1 font-semibold">{step.title}</h2>
            <p className="mt-1 text-sm text-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card block p-4 hover:border-accent">
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Icon name={t.icon} className="size-4" />
              {t.label}
            </p>
            <p className="mt-1 text-3xl font-bold">{t.value}</p>
          </Link>
        ))}
      </div>
      <section className="card p-4">
        <h2 className="text-lg font-semibold">Admins</h2>
        <p className="mt-1 text-sm text-muted">
          Delete the seeded admin if you no longer want those credentials, then create a new one here. If the last admin is deleted, this area asks you to create a replacement before it opens again.
        </p>
        <div className="mt-4">
          <AdminTeam admins={admins} currentId={user.id} />
        </div>
      </section>
      <p className="text-sm text-muted">
        {users} registered user{users === 1 ? "" : "s"} · AI features are {aiEnabled() ? "enabled" : "unavailable until ANTHROPIC_API_KEY is set"}.
      </p>
    </main>
  );
}
