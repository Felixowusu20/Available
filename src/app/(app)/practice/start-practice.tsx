"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { topicKey, type Availability, type Count } from "@/lib/practice/topic-counts";

type Tree = { section: "PRECLINICAL" | "CLINICAL"; disciplines: { name: string; subtopics: string[] }[] }[];
type Mode = "LEARN" | "EXAM";

/** "50 left", "All done" or "No questions yet" for one topic. */
function leftLabel(c: Count | undefined) {
  if (!c || c.total === 0) return "No questions yet";
  return c.left === 0 ? "All done" : `${c.left} left`;
}

function duration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m} min`;
}

export function StartPractice({
  tree,
  secondsPerQuestion,
  available,
  left,
  missedCount,
  bookmarkCount,
}: {
  tree: Tree;
  secondsPerQuestion: number;
  available: { PRECLINICAL: number; CLINICAL: number };
  /** Per topic: published questions and how many this student has not answered yet. */
  left: Availability;
  missedCount: number;
  bookmarkCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mockMode, setMockMode] = useState<Mode>("EXAM");
  const [topicMode, setTopicMode] = useState<Mode>("LEARN");
  const [topicCount, setTopicCount] = useState(20);
  const [disciplines, setDisciplines] = useState<Set<string>>(new Set());
  const [subtopics, setSubtopics] = useState<Set<string>>(new Set()); // "Discipline|Subtopic"
  const [section, setSection] = useState<"PRECLINICAL" | "CLINICAL">("PRECLINICAL");
  const [sectionCount, setSectionCount] = useState(50);
  const [sectionMode, setSectionMode] = useState<Mode>("LEARN");

  async function start(label: string, body: unknown) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message ?? data?.error ?? "Could not start the session.");
        setBusy(null);
        return;
      }
      router.push(`/practice/${data.id}`);
    } catch {
      setError("Network problem. Check your connection and try again.");
      setBusy(null);
    }
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const modeChoice = (value: Mode, set: (m: Mode) => void, name: string) => (
    <fieldset className="flex gap-4 text-sm">
      <legend className="sr-only">Mode</legend>
      {(["EXAM", "LEARN"] as const).map((m) => (
        <label key={m} className="flex min-h-9 items-center gap-2">
          <input type="radio" name={name} checked={value === m} onChange={() => set(m)} />
          {m === "EXAM" ? "Exam (timed, no feedback)" : "Learn (feedback after each question)"}
        </label>
      ))}
    </fieldset>
  );

  const picked = disciplines.size + subtopics.size;
  // Unanswered questions in the current selection (a whole discipline and its subtopics are never picked together).
  const newInSelection =
    [...disciplines].reduce((n, d) => n + (left.disciplines[d]?.left ?? 0), 0) + [...subtopics].reduce((n, k) => n + (left.subtopics[k]?.left ?? 0), 0);
  /** Total and unanswered questions across a list of disciplines. */
  const sumOf = (ds: Tree[number]["disciplines"]): Count =>
    ds.reduce<Count>((acc, d) => ({ total: acc.total + (left.disciplines[d.name]?.total ?? 0), left: acc.left + (left.disciplines[d.name]?.left ?? 0) }), { total: 0, left: 0 });
  const sectionDisciplines = tree.find((t) => t.section === section)?.disciplines ?? [];
  const sectionTotals = sumOf(sectionDisciplines);
  const sectionName = section === "PRECLINICAL" ? "preclinical" : "clinical";
  const mockOk = (size: number) => available.PRECLINICAL >= size / 2 && available.CLINICAL >= size / 2;

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}

      <section className="card space-y-3 p-4" aria-labelledby="mock-h">
        <h2 id="mock-h" className="text-lg font-semibold">
          Mock exam
        </h2>
        <p className="text-sm text-muted">Half preclinical, half clinical, mixed together. Every block of 50 has 25 of each.</p>
        {modeChoice(mockMode, setMockMode, "mockmode")}
        <div className="grid grid-cols-3 gap-2">
          {([50, 100, 200] as const).map((size) => (
            <button
              key={size}
              className="btn flex-col !gap-0"
              disabled={busy !== null || !mockOk(size)}
              onClick={() => start(`mock${size}`, { kind: "MOCK", size, mode: mockMode })}
              title={mockOk(size) ? undefined : "Not enough published questions yet"}
            >
              <span>{busy === `mock${size}` ? "Starting…" : `${size} questions`}</span>
              {mockMode === "EXAM" && <span className="text-xs font-normal opacity-80">{duration(size * secondsPerQuestion)}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="section-h">
        <h2 id="section-h" className="text-lg font-semibold">
          Practise one section
        </h2>
        <p className="text-sm text-muted">Only preclinical or only clinical questions, for example 50 preclinical.</p>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Section</legend>
          {tree.map((t) => {
            const totals = sumOf(t.disciplines);
            return (
              <label key={t.section} className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-lg border p-3 ${section === t.section ? "border-accent bg-accent/10" : "border-line"}`}>
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="section" checked={section === t.section} onChange={() => setSection(t.section)} />
                  {t.section === "PRECLINICAL" ? "Preclinical" : "Clinical"}
                </span>
                <span className="pl-6 text-xs text-muted">{leftLabel(totals)}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm">
            <span className="mb-1 block font-medium">Questions</span>
            <div className="flex flex-wrap items-center gap-2">
              {[20, 50, 100].map((n) => (
                <button key={n} type="button" className={`btn !min-h-10 !px-3 !py-1 ${sectionCount === n ? "" : "btn-ghost"}`} aria-pressed={sectionCount === n} onClick={() => setSectionCount(n)}>
                  {n}
                </button>
              ))}
              <input
                type="number"
                min={5}
                max={200}
                value={sectionCount}
                onChange={(e) => setSectionCount(Math.min(200, Math.max(5, Number(e.target.value) || 5)))}
                className="input !w-24"
                aria-label="Number of questions"
              />
            </div>
          </div>
          {modeChoice(sectionMode, setSectionMode, "sectionmode")}
        </div>
        <button
          className="btn w-full sm:w-auto"
          disabled={busy !== null || sectionTotals.total === 0}
          onClick={() => start("section", { kind: "TOPIC", sections: [section], count: sectionCount, mode: sectionMode })}
        >
          {busy === "section" ? "Starting…" : `Start ${sectionCount} ${sectionName} questions`}
        </button>
        {sectionTotals.total > 0 && (
          <p className="text-sm text-muted" aria-live="polite">
            {sectionTotals.left} {sectionName} question{sectionTotals.left === 1 ? "" : "s"} you have not answered yet.
            {sectionTotals.left < sectionCount && sectionTotals.total >= sectionCount && " Beyond that, questions you have already answered come round again."}
            {sectionTotals.total < sectionCount && ` Only ${sectionTotals.total} ${sectionName} questions are published, so you will get ${sectionTotals.total}.`}
            {sectionMode === "EXAM" && ` Timed: ${duration(Math.min(sectionCount, sectionTotals.total) * secondsPerQuestion)}.`}
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="topic-h">
        <h2 id="topic-h" className="text-lg font-semibold">
          Topic practice
        </h2>
        <div className="space-y-2">
          {tree.map(({ section, disciplines: ds }) => (
            <details key={section} className="rounded-lg border border-line">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 font-medium">
                <span>{section === "PRECLINICAL" ? "Preclinical" : "Clinical"}</span>
                <span className="text-sm font-normal text-muted">{leftLabel(sumOf(ds))}</span>
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {ds.map((d) => (
                  <details key={d.name} className="rounded border border-line/60">
                    <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`All of ${d.name}`}
                        checked={disciplines.has(d.name)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(disciplines, setDisciplines, d.name)}
                        className="size-5"
                      />
                      <span>{d.name}</span>
                      <span className="ml-auto text-sm text-muted">{leftLabel(left.disciplines[d.name])}</span>
                    </summary>
                    {d.subtopics.length > 1 && (
                      <ul className="grid gap-1 px-2 pb-2 pl-9 sm:grid-cols-2">
                        {d.subtopics.map((s) => {
                          const key = `${d.name}|${s}`;
                          return (
                            <li key={key}>
                              <label className="flex min-h-9 items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={subtopics.has(key)}
                                  disabled={disciplines.has(d.name)}
                                  onChange={() => toggle(subtopics, setSubtopics, key)}
                                  className="size-4"
                                />
                                <span>{s}</span>
                                <span className="ml-auto text-xs text-muted">{leftLabel(left.subtopics[topicKey(d.name, s)])}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Questions</span>
            <input
              type="number"
              min={5}
              max={200}
              value={topicCount}
              onChange={(e) => setTopicCount(Math.min(200, Math.max(5, Number(e.target.value) || 5)))}
              className="input !w-28"
            />
          </label>
          {modeChoice(topicMode, setTopicMode, "topicmode")}
        </div>
        <button
          className="btn w-full sm:w-auto"
          disabled={busy !== null || picked === 0}
          onClick={() =>
            start("topic", {
              kind: "TOPIC",
              disciplines: [...disciplines],
              subtopics: [...subtopics].map((k) => {
                const [discipline, subtopic] = k.split("|");
                return { discipline, subtopic };
              }),
              count: topicCount,
              mode: topicMode,
            })
          }
        >
          {busy === "topic" ? "Starting…" : picked === 0 ? "Choose at least one topic" : `Start ${topicCount} questions`}
        </button>
        {picked > 0 && (
          <p className="text-sm text-muted" aria-live="polite">
            {newInSelection} question{newInSelection === 1 ? "" : "s"} you have not answered yet in your selection.
            {newInSelection < topicCount && " Beyond that, questions you have already answered come round again."}
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card space-y-2 p-4">
          <h2 className="text-lg font-semibold">Redo missed</h2>
          <p className="text-sm text-muted">{missedCount} question{missedCount === 1 ? "" : "s"} you last got wrong.</p>
          <button className="btn btn-ghost w-full" disabled={busy !== null || missedCount === 0} onClick={() => start("redo", { kind: "REDO_MISSED", count: 50, mode: "LEARN" })}>
            {busy === "redo" ? "Starting…" : "Redo up to 50"}
          </button>
        </div>
        <div className="card space-y-2 p-4">
          <h2 className="text-lg font-semibold">Bookmarked</h2>
          <p className="text-sm text-muted">{bookmarkCount} bookmarked question{bookmarkCount === 1 ? "" : "s"}.</p>
          <button className="btn btn-ghost w-full" disabled={busy !== null || bookmarkCount === 0} onClick={() => start("bookmarks", { kind: "BOOKMARKS", mode: "LEARN" })}>
            {busy === "bookmarks" ? "Starting…" : "Practise bookmarks"}
          </button>
        </div>
      </section>
    </div>
  );
}
