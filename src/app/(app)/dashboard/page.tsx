import Link from "next/link";
import { Bar } from "@/components/bar";
import { PracticeTopicButton } from "@/components/practice-topic-button";
import { TrendChart } from "@/components/trend-chart";
import { getDashboard, type WeakTopic } from "@/lib/dashboard";
import { requireUser } from "@/lib/guards";
import { pct } from "@/lib/practice/scoring";

export const metadata = { title: "Dashboard" };

const KIND = { MOCK: "Mock", TOPIC: "Topic", REDO_MISSED: "Redo missed", BOOKMARKS: "Bookmarks" } as const;
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function WeakList({ title, empty, items }: { title: string; empty: string; items: WeakTopic[] }) {
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
      {items.map((t) => (
        <div key={`${t.discipline}/${t.subtopic}`} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{t.subtopic ? `${t.discipline} › ${t.subtopic}` : t.discipline}</span>
            <span className="shrink-0 text-muted">
              {t.correct}/{t.answered} · {t.accuracy}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Bar pct={t.accuracy} />
            </div>
            <PracticeTopicButton discipline={t.discipline} subtopic={t.subtopic} />
          </div>
        </div>
      ))}
    </section>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboard(user.id);
  const remaining = Math.max(0, d.seen.total - d.seen.seen);
  const inProgress = d.recent.filter((s) => !s.finished);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Hello{user.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <Link href="/practice" className="btn">
          Start practising
        </Link>
      </div>

      {inProgress.length > 0 && (
        <section className="card space-y-2 border-accent p-4" aria-label="Sessions in progress">
          <h2 className="text-lg font-semibold">Pick up where you left off</h2>
          {inProgress.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {KIND[s.kind as keyof typeof KIND]} · {s.mode === "EXAM" ? "Exam" : "Learn"} · {s.questionCount} questions · started {date(s.startedAt)}
              </span>
              <Link href={`/practice/${s.id}`} className="btn !min-h-9 !px-3 !py-1 text-sm">
                Resume
              </Link>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-muted">Overall accuracy</p>
          <p className="text-3xl font-bold">{d.overall.answered ? `${d.overall.accuracy}%` : "–"}</p>
          <p className="text-xs text-muted">
            {d.overall.correct}/{d.overall.answered} answered correctly
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Sessions finished</p>
          <p className="text-3xl font-bold">{d.sessionsFinished}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Questions seen</p>
          <p className="text-3xl font-bold">
            {d.seen.seen}
            <span className="text-base font-normal text-muted"> / {d.seen.total}</span>
          </p>
          <p className="text-xs text-muted">{remaining} still to see</p>
        </div>
      </div>

      <section className="card space-y-3 p-4" aria-label="Seen and remaining">
        <h2 className="text-lg font-semibold">Coverage of the question bank</h2>
        {(["PRECLINICAL", "CLINICAL"] as const).map((s) => (
          <div key={s} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{s === "PRECLINICAL" ? "Preclinical" : "Clinical"}</span>
              <span>
                {d.seen.bySection[s].seen}/{d.seen.bySection[s].total} seen
              </span>
            </div>
            <Bar neutral pct={pct(d.seen.bySection[s].seen, d.seen.bySection[s].total)} />
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-4" aria-label="Accuracy trend">
        <h2 className="text-lg font-semibold">Accuracy trend</h2>
        <TrendChart points={d.trend.map((t) => ({ pct: t.pct, label: `${KIND[t.kind as keyof typeof KIND]} on ${date(t.at)}` }))} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <WeakList title="Weakest disciplines" empty="Answer at least 5 questions in a discipline (in finished sessions) to see it here." items={d.weakDisciplines} />
        <WeakList title="Weakest subtopics" empty="Answer at least 3 questions in a subtopic (in finished sessions) to see it here." items={d.weakSubtopics} />
      </div>

      <section className="card p-4" aria-label="History">
        <h2 className="mb-2 text-lg font-semibold">Session history</h2>
        {d.recent.length === 0 && <p className="text-sm text-muted">No sessions yet.</p>}
        <ul className="divide-y divide-line">
          {d.recent.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {date(s.startedAt)} · {KIND[s.kind as keyof typeof KIND]} · {s.mode === "EXAM" ? "Exam" : "Learn"}
              </span>
              {s.finished ? (
                <Link className="underline" href={`/results/${s.id}`}>
                  {s.correct ?? 0}/{s.questionCount} ({pct(s.correct ?? 0, s.questionCount)}%)
                </Link>
              ) : (
                <Link className="underline" href={`/practice/${s.id}`}>
                  In progress
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
