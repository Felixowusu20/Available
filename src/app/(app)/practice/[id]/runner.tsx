"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportDialog } from "@/components/report-dialog";
import type { Feedback, MapEntry, QuestionPayload, SessionState } from "@/lib/practice/service";

const LETTERS = ["A", "B", "C", "D"];
const WINDOW = 10;

type AnswerBody = { selected: number | null; guessed: boolean; timeSpentMs: number };
type SaveStatus = "idle" | "saving" | "offline";

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function Runner({
  initialState,
  initialQuestions,
  startAt,
}: {
  initialState: SessionState;
  initialQuestions: QuestionPayload[];
  startAt: number;
}) {
  const router = useRouter();
  const id = initialState.id;
  const total = initialState.questionCount;

  const [state, setState] = useState(initialState);
  const [qs, setQs] = useState<Record<number, QuestionPayload>>(() => Object.fromEntries(initialQuestions.map((q) => [q.position, q])));
  const [pos, setPos] = useState(startAt);
  const [showMap, setShowMap] = useState(false);
  const [dialog, setDialog] = useState<null | "finish" | "switch" | "report">(null);
  const [save, setSave] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  // "Now" on the server's clock. Starts from the server's own timestamp and is advanced by the
  // timer below using a measured offset, so a wrong device clock cannot distort the countdown.
  const [now, setNow] = useState(() => Date.parse(initialState.serverNow));

  // Refs hold values that async callbacks and the keyboard handler must read fresh.
  const qsRef = useRef(qs);
  const posRef = useRef(pos);
  const stateRef = useRef(state);
  useEffect(() => {
    qsRef.current = qs;
    posRef.current = pos;
    stateRef.current = state;
  });
  const skew = useRef(0); // server clock minus device clock
  const enteredAt = useRef(0);
  useEffect(() => {
    skew.current = Date.parse(initialState.serverNow) - Date.now();
    enteredAt.current = Date.now();
  }, [initialState.serverNow]);
  const extraMs = useRef<Record<number, number>>({}); // time spent this page-load, per position
  const pending = useRef(new Map<number, AnswerBody>());
  const flushing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loading = useRef(new Set<number>());

  const mode = state.mode;
  const q = qs[pos];
  const revealed = !!q?.feedback;
  const locked = mode === "LEARN" && q?.selected != null;

  // ---- loading question windows ------------------------------------------------------------
  const ensure = useCallback(
    async (p: number) => {
      if (p < 0 || p >= total || qsRef.current[p]) return;
      const from = Math.floor(p / WINDOW) * WINDOW;
      if (loading.current.has(from)) return;
      loading.current.add(from);
      try {
        const res = await fetch(`/api/sessions/${id}/questions?from=${from}&count=${WINDOW}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { questions: QuestionPayload[] };
          setQs((prev) => {
            const next = { ...prev };
            for (const item of data.questions) next[item.position] ??= item;
            return next;
          });
        }
      } catch {
        /* offline: the effect below retries when the position changes or connectivity returns */
      } finally {
        loading.current.delete(from);
      }
    },
    [id, total],
  );

  // Fetching the windows around the current question is the effect's job; state is set after the await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void ensure(pos);
    void ensure(pos + 3);
  }, [pos, qs, ensure]);

  useEffect(() => {
    const retry = () => void ensure(posRef.current);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [ensure]);

  // ---- saving answers -----------------------------------------------------------------------
  const applyFeedback = useCallback((p: number, selected: number | null, feedback: Feedback | undefined) => {
    setQs((prev) => (prev[p] ? { ...prev, [p]: { ...prev[p], selected, feedback: feedback ?? prev[p].feedback } } : prev));
    if (feedback && selected !== null) {
      setState((s) => ({ ...s, map: s.map.map((m, i) => (i === p ? { ...m, answered: true, result: feedback.correctSlot === selected ? "correct" : "wrong" } : m)) }));
    }
  }, []);

  const bodyFor = useCallback((p: number): AnswerBody | null => {
    const item = qsRef.current[p];
    if (!item) return null;
    const live = p === posRef.current ? Date.now() - enteredAt.current : 0;
    return { selected: item.selected, guessed: item.guessed, timeSpentMs: item.timeSpentMs + (extraMs.current[p] ?? 0) + live };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSave("saving");
    try {
      while (pending.current.size > 0) {
        const [p, body] = pending.current.entries().next().value as [number, AnswerBody];
        let res: Response;
        try {
          res = await fetch(`/api/sessions/${id}/questions/${p}/answer`, { method: "PUT", ...json(body) });
        } catch {
          setSave("offline");
          retryTimer.current = setTimeout(() => void flush(), 4000);
          return;
        }
        if (res.status >= 500) {
          setSave("offline");
          retryTimer.current = setTimeout(() => void flush(), 4000);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          pending.current.delete(p);
          setError(data?.error ?? "Could not save that answer.");
          continue;
        }
        const data = (await res.json()) as { selected: number | null; feedback?: Feedback };
        // Only clear the entry if nothing newer was queued while this request was in flight.
        if (JSON.stringify(pending.current.get(p)) === JSON.stringify(body)) pending.current.delete(p);
        if (data.feedback) applyFeedback(p, data.selected, data.feedback);
      }
      setSave("idle");
    } finally {
      flushing.current = false;
    }
  }, [id, applyFeedback]);

  const enqueue = useCallback(
    (p: number) => {
      const body = bodyFor(p);
      if (!body) return;
      pending.current.set(p, body);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      void flush();
    },
    [bodyFor, flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---- actions ------------------------------------------------------------------------------
  const patchQ = (p: number, patch: Partial<QuestionPayload>) => setQs((prev) => (prev[p] ? { ...prev, [p]: { ...prev[p], ...patch } } : prev));
  const patchMap = (p: number, patch: Partial<MapEntry>) => setState((s) => ({ ...s, map: s.map.map((m, i) => (i === p ? { ...m, ...patch } : m)) }));

  async function choose(slot: number) {
    const cur = qsRef.current[posRef.current];
    const p = posRef.current;
    if (!cur || stateRef.current.finished || finishing) return;
    setError(null);
    (document.activeElement as HTMLElement | null)?.blur();

    if (stateRef.current.mode === "LEARN") {
      if (cur.selected !== null) return;
      patchQ(p, { selected: slot });
      const body = bodyFor(p)!;
      try {
        const res = await fetch(`/api/sessions/${id}/questions/${p}/answer`, { method: "PUT", ...json({ ...body, selected: slot }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "failed");
        const data = (await res.json()) as { selected: number | null; feedback?: Feedback };
        applyFeedback(p, data.selected, data.feedback);
      } catch (e) {
        patchQ(p, { selected: null });
        setError(e instanceof Error && e.message !== "failed" ? e.message : "No connection. Try that answer again.");
      }
      return;
    }

    // Exam mode: tapping the chosen option again clears it.
    const next = cur.selected === slot ? null : slot;
    patchQ(p, { selected: next, guessed: next === null ? false : cur.guessed });
    patchMap(p, { answered: next !== null });
    qsRef.current = { ...qsRef.current, [p]: { ...cur, selected: next, guessed: next === null ? false : cur.guessed } };
    enqueue(p);
  }

  function toggleGuess() {
    const p = posRef.current;
    const cur = qsRef.current[p];
    if (!cur || locked) return;
    patchQ(p, { guessed: !cur.guessed });
    qsRef.current = { ...qsRef.current, [p]: { ...cur, guessed: !cur.guessed } };
    if (stateRef.current.mode === "EXAM" && cur.selected !== null) enqueue(p);
  }

  async function toggleFlag() {
    const p = posRef.current;
    const cur = qsRef.current[p];
    if (!cur) return;
    const flagged = !cur.flagged;
    patchQ(p, { flagged });
    patchMap(p, { flagged });
    try {
      const res = await fetch(`/api/sessions/${id}/questions/${p}/flag`, { method: "PUT", ...json({ flagged }) });
      if (!res.ok) throw new Error();
    } catch {
      patchQ(p, { flagged: !flagged });
      patchMap(p, { flagged: !flagged });
      setError("Couldn't save the flag. Check your connection.");
    }
  }

  async function toggleBookmark() {
    const p = posRef.current;
    const cur = qsRef.current[p];
    if (!cur) return;
    const bookmarked = !cur.bookmarked;
    patchQ(p, { bookmarked });
    try {
      const res = await fetch(`/api/sessions/${id}/questions/${p}/bookmark`, { method: "PUT", ...json({ bookmarked }) });
      if (!res.ok) throw new Error();
    } catch {
      patchQ(p, { bookmarked: !bookmarked });
      setError("Couldn't save the bookmark. Check your connection.");
    }
  }

  function go(target: number) {
    const next = Math.min(total - 1, Math.max(0, target));
    if (next === posRef.current) return;
    const leaving = posRef.current;
    extraMs.current[leaving] = (extraMs.current[leaving] ?? 0) + (Date.now() - enteredAt.current);
    enteredAt.current = Date.now();
    if (qsRef.current[leaving]?.selected != null) enqueue(leaving); // persist time spent
    setPos(next);
    setShowMap(false);
    window.scrollTo({ top: 0 });
  }

  async function flushAll() {
    for (let i = 0; i < 5 && (pending.current.size > 0 || flushing.current); i++) {
      if (!flushing.current) await flush();
      else await new Promise((r) => setTimeout(r, 400));
    }
  }

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setDialog(null);
    const leaving = posRef.current;
    extraMs.current[leaving] = (extraMs.current[leaving] ?? 0) + (Date.now() - enteredAt.current);
    enteredAt.current = Date.now();
    if (stateRef.current.mode === "EXAM" && qsRef.current[leaving]?.selected != null) enqueue(leaving);
    await flushAll();
    try {
      const res = await fetch(`/api/sessions/${id}/finish`, { method: "POST" });
      if (!res.ok) throw new Error();
      router.push(`/results/${id}`);
    } catch {
      setFinishing(false);
      setError("Couldn't finish: no connection. Your answers are saved; try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, id, router, enqueue]);

  async function switchToLearn() {
    setDialog(null);
    await flushAll();
    try {
      const res = await fetch(`/api/sessions/${id}/switch-to-learn`, { method: "POST" });
      if (!res.ok) throw new Error();
      setState((s) => ({ ...s, mode: "LEARN", deadline: null, switchedFromExam: true }));
      setQs({}); // reload so feedback appears for questions already answered
    } catch {
      setError("Couldn't switch modes. Check your connection.");
    }
  }

  // ---- timer --------------------------------------------------------------------------------
  const deadline = state.deadline ? Date.parse(state.deadline) : null;
  useEffect(() => {
    if (!deadline || state.finished) return;
    const t = setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => clearInterval(t);
  }, [deadline, state.finished]);
  const remaining = deadline ? deadline - now : null;
  useEffect(() => {
    // Time is up: finishing is a deliberate side effect (it saves, closes the session and navigates).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (remaining !== null && remaining <= 0 && !finishing) void finish();
  }, [remaining, finishing, finish]);

  // ---- keyboard shortcuts (desktop) -----------------------------------------------------------
  const actions = useRef({ choose, go, toggleFlag, toggleBookmark, setShowMap, setDialog });
  // Runs after every render on purpose: the single keydown listener below always calls the latest handlers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    actions.current = { choose, go, toggleFlag, toggleBookmark, setShowMap, setDialog };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") {
        if (!(e.key === "Escape")) return;
      }
      const a = actions.current;
      const key = e.key.toLowerCase();
      if (key === "escape") return a.setDialog(null);
      if (/^[a-d]$/.test(key)) return void a.choose(key.charCodeAt(0) - 97);
      if (/^[1-4]$/.test(key)) return void a.choose(Number(key) - 1);
      if (key === "enter" || key === "arrowright") {
        e.preventDefault();
        const p = posRef.current;
        const cur = qsRef.current[p];
        if (key === "enter" && stateRef.current.mode === "LEARN" && cur?.selected == null) return;
        if (p >= total - 1) return key === "enter" ? a.setDialog("finish") : undefined;
        return a.go(p + 1);
      }
      if (key === "arrowleft") return a.go(posRef.current - 1);
      if (key === "f") return void a.toggleFlag();
      if (key === "b") return void a.toggleBookmark();
      if (key === "m") return a.setShowMap((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  // ---- derived UI data ----------------------------------------------------------------------------
  const answeredCount = state.map.filter((m) => m.answered).length;
  const flaggedCount = state.map.filter((m) => m.flagged).length;
  const unanswered = total - answeredCount;
  const lowTime = remaining !== null && remaining < 5 * 60 * 1000;

  function optionClass(i: number) {
    const base = "flex w-full min-h-12 items-start gap-3 rounded-lg border p-3 text-left transition-colors";
    if (q?.feedback) {
      if (i === q.feedback.correctSlot) return `${base} border-ok bg-ok-bg`;
      if (i === q.selected) return `${base} border-bad bg-bad-bg`;
      return `${base} border-line opacity-70`;
    }
    if (i === q?.selected) return `${base} border-accent bg-accent/10`;
    return `${base} border-line bg-card hover:border-accent`;
  }

  function mapClass(i: number) {
    const m = state.map[i];
    const base = "relative h-10 min-w-10 rounded border text-sm font-medium";
    let tone = "border-line bg-card";
    if (m.result === "correct") tone = "border-ok bg-ok-bg text-ok";
    else if (m.result === "wrong") tone = "border-bad bg-bad-bg text-bad";
    else if (m.answered) tone = "border-accent bg-accent/15";
    return `${base} ${tone} ${i === pos ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""}`;
  }

  const blocks = Array.from({ length: Math.ceil(total / 50) }, (_, b) => b);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-3">
      {/* Top bar */}
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <div className="text-sm">
          <span className="font-semibold">
            Q {pos + 1}/{total}
          </span>
          {total > 50 && <span className="text-muted"> · Block {Math.floor(pos / 50) + 1}</span>}
          <span className="ml-2 rounded bg-card px-1.5 py-0.5 text-xs text-muted ring-1 ring-line">{mode === "EXAM" ? "Exam" : "Learn"}</span>
        </div>
        {remaining !== null && (
          <div className={`font-mono text-sm font-semibold ${lowTime ? "text-bad" : ""}`} role="timer" aria-label="Time remaining">
            {clock(remaining)}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted" aria-live="polite">
            {save === "saving" ? "Saving…" : save === "offline" ? "Offline: will retry" : ""}
          </span>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1 text-sm" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>
            Map
          </button>
          <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setDialog("finish")} disabled={finishing}>
            Finish
          </button>
        </div>
      </div>

      {showMap && (
        <section className="card mt-3 space-y-3 p-3" aria-label="Question map">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>Answered {answeredCount}</span>
            <span>Flagged {flaggedCount}</span>
            <span>Unanswered {unanswered}</span>
            {mode === "LEARN" && <span>Green correct · Red wrong</span>}
          </p>
          {blocks.map((b) => (
            <div key={b}>
              {blocks.length > 1 && <h3 className="mb-1 text-xs font-semibold text-muted">Block {b + 1}</h3>}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
                {Array.from({ length: Math.min(50, total - b * 50) }, (_, k) => b * 50 + k).map((i) => (
                  <button key={i} className={mapClass(i)} onClick={() => go(i)} aria-label={`Question ${i + 1}${state.map[i].flagged ? ", flagged" : ""}${state.map[i].answered ? ", answered" : ""}`}>
                    {i + 1}
                    {state.map[i].flagged && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warn" aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}

      {/* Question */}
      {q ? (
        <section className="mt-4 space-y-4" aria-label={`Question ${pos + 1}`}>
          <p className="whitespace-pre-line text-lg leading-relaxed">{q.stem}</p>

          <div role="group" aria-label="Answer options" className="space-y-2">
            {q.options.map((text, i) => (
              <button key={i} className={optionClass(i)} onClick={() => void choose(i)} aria-pressed={q.selected === i} disabled={finishing || (locked && q.selected !== i && !revealed)}>
                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold">{LETTERS[i]}</span>
                <span className="whitespace-pre-line">{text}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="size-5" checked={q.guessed} onChange={toggleGuess} disabled={locked} />I am guessing
            </label>
            <button className={`btn btn-ghost !min-h-10 !px-3 !py-1 text-sm ${q.flagged ? "!border-warn !text-warn" : ""}`} onClick={() => void toggleFlag()} aria-pressed={q.flagged}>
              {q.flagged ? "Flagged" : "Flag for review"}
            </button>
            <button className={`btn btn-ghost !min-h-10 !px-3 !py-1 text-sm ${q.bookmarked ? "!border-accent !text-accent" : ""}`} onClick={() => void toggleBookmark()} aria-pressed={q.bookmarked}>
              {q.bookmarked ? "Bookmarked" : "Bookmark"}
            </button>
            <button className={`btn btn-ghost !min-h-10 !px-3 !py-1 text-sm ${q.reported ? "!border-accent !text-accent" : ""}`} onClick={() => setDialog("report")}>
              {q.reported ? "Reported" : "Report a problem"}
            </button>
          </div>

          {q.feedback && (
            <div className="card space-y-2 p-4" role="status" aria-live="polite">
              <p className={`font-semibold ${q.selected === q.feedback.correctSlot ? "text-ok" : "text-bad"}`}>
                {q.selected === null ? `Not answered. The answer is ${LETTERS[q.feedback.correctSlot]}.` : q.selected === q.feedback.correctSlot ? "Correct" : `Incorrect. The answer is ${LETTERS[q.feedback.correctSlot]}.`}
              </p>
              {q.feedback.explanation ? <p className="whitespace-pre-line leading-relaxed">{q.feedback.explanation}</p> : <p className="text-muted">No explanation available for this question.</p>}
              <p className="text-xs text-muted">
                {q.feedback.discipline} › {q.feedback.subtopic}
              </p>
            </div>
          )}

          {mode === "EXAM" && (
            <button className="text-sm text-muted underline" onClick={() => setDialog("switch")}>
              Switch to learn mode (keeps your answers)
            </button>
          )}
          <p className="hidden text-xs text-muted md:block">Keys: A–D or 1–4 answer · Enter/→ next · ← back · F flag · B bookmark · M map</p>
        </section>
      ) : (
        <p className="mt-8 text-center text-muted" role="status">
          Loading question…
        </p>
      )}

      {/* Bottom navigation */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-3 px-4 py-2">
          <button className="btn btn-ghost flex-1" onClick={() => go(pos - 1)} disabled={pos === 0}>
            Previous
          </button>
          {pos >= total - 1 ? (
            <button className="btn flex-1" onClick={() => setDialog("finish")} disabled={finishing}>
              Finish
            </button>
          ) : (
            <button className="btn flex-1" onClick={() => go(pos + 1)}>
              Next
            </button>
          )}
        </div>
      </div>

      {dialog === "report" && q && (
        <ReportDialog sessionId={id} position={pos} revealed={revealed} alreadyReported={q.reported} onClose={() => setDialog(null)} onSent={() => patchQ(pos, { reported: true })} />
      )}

      {/* Confirmation dialogs */}
      {(dialog === "finish" || dialog === "switch") && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          <div className="card w-full max-w-md space-y-3 p-5">
            {dialog === "finish" ? (
              <>
                <h2 id="dlg-title" className="text-lg font-semibold">
                  Finish this session?
                </h2>
                <p className="text-sm text-muted">
                  {unanswered > 0 ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} unanswered and will count as wrong. ` : "All questions are answered. "}
                  {flaggedCount > 0 && `${flaggedCount} flagged for review. `}
                  You can&apos;t change answers afterwards.
                </p>
                <div className="flex gap-3">
                  <button className="btn btn-ghost flex-1" onClick={() => setDialog(null)}>
                    Keep going
                  </button>
                  <button className="btn flex-1" onClick={() => void finish()}>
                    Finish
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="dlg-title" className="text-lg font-semibold">
                  Switch to learn mode?
                </h2>
                <p className="text-sm text-muted">Your answers are kept and the timer stops. You will see explanations for questions you have already answered, and new answers lock in as soon as you pick them. This can&apos;t be undone.</p>
                <div className="flex gap-3">
                  <button className="btn btn-ghost flex-1" onClick={() => setDialog(null)}>
                    Stay in exam
                  </button>
                  <button className="btn flex-1" onClick={() => void switchToLearn()}>
                    Switch
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
