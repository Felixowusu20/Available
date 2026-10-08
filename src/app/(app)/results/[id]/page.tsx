import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bar } from "@/components/bar";
import { requireUser } from "@/lib/guards";
import { pct } from "@/lib/practice/scoring";
import { getResults } from "@/lib/practice/service";
import { ServiceError } from "@/lib/practice/http";

export const metadata = { title: "Results" };
const LETTERS = ["A", "B", "C", "D"];
const KIND_LABEL = { MOCK: "Mock exam", TOPIC: "Topic practice", REDO_MISSED: "Redo missed", BOOKMARKS: "Bookmarks" } as const;

function duration(ms: number) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let data;
  try {
    data = await getResults(user.id, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  if (!data) redirect(`/practice/${id}`);

  const { session, summary, questions } = data;
  const missed = questions.filter((q) => !q.correct);
  const spent = session.finishedAt.getTime() - session.startedAt.getTime();
  const guessedPct = pct(summary.guessed.correct, summary.guessed.count);
  const confidentPct = pct(summary.confident.correct, summary.confident.count);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <p className="text-sm text-muted">
          {KIND_LABEL[session.kind]} · {session.mode === "EXAM" ? "Exam" : "Learn"}
          {session.switchedFromExam && " (switched from exam)"} · {duration(spent)}
        </p>
        <h1 className="text-2xl font-bold">Results</h1>
      </div>

      <section className="card space-y-3 p-4" aria-label="Score">
        <p className="text-4xl font-bold">
          {summary.correct}
          <span className="text-xl font-normal text-muted"> / {summary.total}</span>
          <span className="ml-3 text-2xl">{summary.scorePct}%</span>
        </p>
        <Bar pct={summary.scorePct} />
        <p className="text-sm text-muted">
          {summary.answered} answered, {summary.total - summary.answered} unanswered (counted as wrong).
        </p>
      </section>

      <section className="card space-y-3 p-4" aria-label="Guesses">
        <h2 className="text-lg font-semibold">Guesses</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted">Confident answers</p>
            <p className="font-semibold">
              {summary.confident.correct}/{summary.confident.count} correct ({confidentPct}%)
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Marked &quot;I am guessing&quot;</p>
            <p className="font-semibold">
              {summary.guessed.correct}/{summary.guessed.count} correct ({guessedPct}%)
            </p>
          </div>
        </div>
        {summary.guessed.count > 0 && <p className="text-sm text-muted">Without the guesses that landed, your score would be about {pct(summary.correct - summary.guessed.correct, summary.total)}%.</p>}
      </section>

      <section className="card space-y-3 p-4" aria-label="Preclinical and clinical">
        <h2 className="text-lg font-semibold">Preclinical vs clinical</h2>
        {(["PRECLINICAL", "CLINICAL"] as const).map((s) => {
          const t = summary.bySection[s];
          if (t.total === 0) return null;
          const p = pct(t.correct, t.total);
          return (
            <div key={s} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{s === "PRECLINICAL" ? "Preclinical" : "Clinical"}</span>
                <span>
                  {t.correct}/{t.total} ({p}%)
                </span>
              </div>
              <Bar pct={p} />
            </div>
          );
        })}
      </section>

      {summary.byBlock.length > 1 && (
        <section className="card space-y-3 p-4" aria-label="Blocks of 50">
          <h2 className="text-lg font-semibold">By block of 50</h2>
          {summary.byBlock.map((b) => (
            <div key={b.block} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>Block {b.block + 1}</span>
                <span>
                  {b.correct}/{b.total} ({pct(b.correct, b.total)}%)
                </span>
              </div>
              <Bar pct={pct(b.correct, b.total)} />
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3 p-4" aria-label="Topics">
        <h2 className="text-lg font-semibold">Topics, weakest first</h2>
        {summary.byDiscipline.map((d) => (
          <div key={d.key} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{d.discipline}</span>
              <span className="shrink-0">
                {d.correct}/{d.total} ({d.accuracy}%)
              </span>
            </div>
            <Bar pct={d.accuracy} />
          </div>
        ))}
        <details className="pt-1">
          <summary className="cursor-pointer text-sm underline">Show subtopics</summary>
          <ul className="mt-2 space-y-2">
            {summary.bySubtopic.map((s) => (
              <li key={s.key} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span>{s.key}</span>
                  <span className="shrink-0">
                    {s.correct}/{s.total}
                  </span>
                </div>
                <Bar pct={s.accuracy} />
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="space-y-3" aria-label="Missed questions">
        <h2 className="text-lg font-semibold">Missed questions ({missed.length})</h2>
        {missed.length === 0 && <p className="text-muted">Nothing missed. Well done.</p>}
        {missed.map((q) => (
          <details key={q.position} className="card p-4">
            <summary className="cursor-pointer">
              <span className="font-medium">Q{q.position + 1}.</span> <span className="whitespace-pre-line">{q.stem}</span>
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <ul className="space-y-1">
                {q.options.map((o, i) => (
                  <li key={i} className={`rounded border p-2 ${i === q.correctSlot ? "border-ok bg-ok-bg" : i === q.selected ? "border-bad bg-bad-bg" : "border-line"}`}>
                    <strong>{LETTERS[i]}.</strong> {o}
                    {i === q.correctSlot && " ✓ correct"}
                    {i === q.selected && i !== q.correctSlot && " ✗ your answer"}
                  </li>
                ))}
              </ul>
              {q.selected === null && <p className="text-muted">You didn&apos;t answer this one.</p>}
              {q.guessed && <p className="text-muted">You marked this as a guess.</p>}
              <p className="whitespace-pre-line leading-relaxed">{q.explanation || "No explanation available for this question."}</p>
              <p className="text-xs text-muted">
                {q.discipline} › {q.subtopic}
              </p>
            </div>
          </details>
        ))}
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/practice" className="btn">
          Practise again
        </Link>
        <Link href="/dashboard" className="btn btn-ghost">
          Dashboard
        </Link>
      </div>
    </main>
  );
}
