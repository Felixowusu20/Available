import Link from "next/link";
import { REASON_LABEL } from "@/lib/report-reasons";
import { listClosedReports, listOpenReportGroups } from "@/lib/reports";
import { ReportGroupCard, type GroupView } from "./report-group-card";

export const metadata = { title: "Reports" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const closedView = one(sp.view) === "closed";
  const questionId = one(sp.question)?.slice(0, 40);
  const keep = (view: "open" | "closed") => `/admin/reports?view=${view}${questionId ? `&question=${encodeURIComponent(questionId)}` : ""}`;

  const [open, closed] = await Promise.all([listOpenReportGroups({ questionId }), closedView ? listClosedReports({ questionId }) : Promise.resolve([])]);

  const groups: GroupView[] = open.groups.map((g) => ({
    question: g.question,
    reports: g.reports.map((r) => ({ id: r.id, reason: r.reason, comment: r.comment, reporter: r.reporter, when: when(r.at) })),
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Reported questions</h1>
        <p className="text-sm text-muted">
          Students report problems from the practice screen and from their results. Fix the question if needed, then close its reports as fixed, or as needing no change.
        </p>
      </div>

      <nav className="flex gap-2 text-sm" aria-label="Report views">
        <Link href={keep("open")} aria-current={closedView ? undefined : "page"} className={`btn !min-h-9 !px-3 !py-1 ${closedView ? "btn-ghost" : ""}`}>
          Open ({open.totalQuestions})
        </Link>
        <Link href={keep("closed")} aria-current={closedView ? "page" : undefined} className={`btn !min-h-9 !px-3 !py-1 ${closedView ? "" : "btn-ghost"}`}>
          Closed
        </Link>
      </nav>

      {questionId && (
        <p className="text-sm text-muted">
          Showing one question.{" "}
          <Link href={`/admin/reports?view=${closedView ? "closed" : "open"}`} className="underline">
            Show all
          </Link>
        </p>
      )}

      {!closedView && (
        <section aria-label="Open reports" className="space-y-3">
          {open.totalQuestions > groups.length && <p className="text-sm text-muted">Showing the {groups.length} most reported of {open.totalQuestions} questions.</p>}
          {groups.length === 0 && <p className="text-muted">Nothing is waiting. No open reports.</p>}
          {groups.map((g) => (
            <ReportGroupCard key={g.question.id} g={g} />
          ))}
        </section>
      )}

      {closedView && (
        <section aria-label="Closed reports" className="space-y-3">
          {closed.length === 0 && <p className="text-muted">No closed reports yet.</p>}
          {closed.length > 0 && <p className="text-sm text-muted">The {closed.length} most recently closed.</p>}
          <ul className="space-y-2">
            {closed.map((r) => (
              <li key={r.id} className="card space-y-1 p-3 text-sm">
                <Link href={`/admin/questions/${r.question.id}`} className="line-clamp-2 underline-offset-2 hover:underline">
                  {r.question.stem}
                </Link>
                <p className="break-words text-xs text-muted">
                  <span className={`mr-2 rounded px-1.5 py-0.5 font-medium ${r.status === "RESOLVED" ? "bg-ok-bg text-ok" : "bg-line"}`}>{r.status === "RESOLVED" ? "Fixed" : "No change needed"}</span>
                  {REASON_LABEL[r.reason]} · reported by {r.reporter} · closed {r.closedAt ? when(r.closedAt) : ""}
                  {r.closedBy ? ` by ${r.closedBy}` : ""}
                </p>
                {r.comment && <p className="whitespace-pre-line break-words">&ldquo;{r.comment}&rdquo;</p>}
                {r.note && <p className="whitespace-pre-line break-words text-muted">Admin note: {r.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
