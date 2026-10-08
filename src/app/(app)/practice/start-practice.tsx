"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Tree = { section: "PRECLINICAL" | "CLINICAL"; disciplines: { name: string; subtopics: string[] }[] }[];
type Mode = "LEARN" | "EXAM";

function duration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m} min`;
}

export function StartPractice({
  tree,
  secondsPerQuestion,
  available,
  missedCount,
  bookmarkCount,
}: {
  tree: Tree;
  secondsPerQuestion: number;
  available: { PRECLINICAL: number; CLINICAL: number };
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

      <section className="card space-y-3 p-4" aria-labelledby="topic-h">
        <h2 id="topic-h" className="text-lg font-semibold">
          Topic practice
        </h2>
        <div className="space-y-2">
          {tree.map(({ section, disciplines: ds }) => (
            <details key={section} className="rounded-lg border border-line">
              <summary className="cursor-pointer select-none px-3 py-2 font-medium">{section === "PRECLINICAL" ? "Preclinical" : "Clinical"}</summary>
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
                                {s}
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
