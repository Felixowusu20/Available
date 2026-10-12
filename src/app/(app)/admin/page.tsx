import Link from "next/link";
import { statusCounts } from "@/lib/admin/questions";
import { countReportedQuestions } from "@/lib/reports";
import { aiEnabled } from "@/lib/env";
import { db } from "@/lib/db";

export const metadata = { title: "Admin" };

export default async function AdminHome() {
  const [counts, pendingSuggestions, users, reported] = await Promise.all([
    statusCounts(),
    db.aiSuggestion.count({ where: { status: "PENDING" } }),
    db.user.count(),
    countReportedQuestions(),
  ]);
  const tiles = [
    { label: "Published", value: counts.PUBLISHED, href: "/admin/questions?status=PUBLISHED" },
    { label: "In review", value: counts.IN_REVIEW, href: "/admin/questions?status=IN_REVIEW" },
    { label: "Drafts", value: counts.DRAFT, href: "/admin/questions?status=DRAFT" },
    { label: "Untagged", value: counts.untagged, href: "/admin/questions?untagged=1" },
    { label: "High priority (published)", value: counts.highPriority, href: "/admin/questions?priority=1&status=PUBLISHED" },
    { label: "Retired", value: counts.RETIRED, href: "/admin/questions?status=RETIRED" },
    { label: "AI suggestions to review", value: pendingSuggestions, href: "/admin/ai" },
    { label: "Questions reported by students", value: reported, href: "/admin/reports" },
  ];
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card block p-4 hover:border-accent">
            <p className="text-sm text-muted">{t.label}</p>
            <p className="text-3xl font-bold">{t.value}</p>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/admin/questions/new" className="btn">
          New question
        </Link>
        <Link href="/admin/import" className="btn btn-ghost">
          Import questions
        </Link>
      </div>
      <p className="text-sm text-muted">
        {users} registered user{users === 1 ? "" : "s"} · AI features are {aiEnabled() ? "enabled" : "unavailable (no ANTHROPIC_API_KEY set)"}.
      </p>
    </main>
  );
}
