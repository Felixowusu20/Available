"use client";

import { useEffect, useRef, useState } from "react";
import { COMMENT_MAX, NEEDS_ANSWER_REVEALED, REASON_LABEL, REPORT_REASONS, reportSchema, type ReportReasonValue } from "@/lib/report-reasons";

/**
 * Modal form for reporting the question at `position` of a session. The browser never handles a
 * question id: the server finds the question through the student's own session.
 */
export function ReportDialog({
  sessionId,
  position,
  revealed,
  alreadyReported,
  onClose,
  onSent,
}: {
  sessionId: string;
  position: number;
  /** The student has seen the answer and explanation, so "answer looks wrong" is something they can judge. */
  revealed: boolean;
  alreadyReported: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [reason, setReason] = useState<ReportReasonValue | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Put focus in the dialog when it opens and again when the thank-you message replaces the form.
  useEffect(() => heading.current?.focus(), [sent]);

  const reasons = REPORT_REASONS.filter((r) => revealed || !NEEDS_ANSWER_REVEALED.has(r));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = reportSchema.safeParse({ reason, comment });
    if (!parsed.success) {
      setError(reason ? (parsed.error.issues[0]?.message ?? "Check what you entered.") : "Choose what is wrong.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/questions/${position}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.issues?.[0]?.message ?? data?.error ?? "Could not send the report.");
      }
      setSent(true);
      onSent();
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="card max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto p-5">
        {sent ? (
          <>
            <h2 id="report-title" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
              Thank you
            </h2>
            <p className="text-sm text-muted" role="status">
              Your report was sent. An admin will look at this question.
            </p>
            <button type="button" className="btn w-full" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <form onSubmit={send} className="space-y-3">
            <h2 id="report-title" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
              Report a problem with this question
            </h2>
            {alreadyReported && <p className="rounded-lg bg-accent/10 p-2 text-sm">You have already reported this question. Sending again replaces your earlier report.</p>}
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">What is wrong?</legend>
              {reasons.map((r) => (
                <label key={r} className="flex min-h-11 items-start gap-2 rounded-lg px-1 py-2 text-sm">
                  <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="mt-0.5 size-5 shrink-0" />
                  <span>{REASON_LABEL[r]}</span>
                </label>
              ))}
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Details{reason === "OTHER" ? "" : " (optional)"}</span>
              <textarea
                className="input min-h-24"
                value={comment}
                maxLength={COMMENT_MAX}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should it say, or why do you think it is wrong?"
              />
              <span className="mt-1 block text-right text-xs text-muted">
                {comment.length}/{COMMENT_MAX}
              </span>
            </label>
            {error && (
              <p role="alert" className="rounded-lg bg-bad-bg p-2 text-sm text-bad">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn flex-1" disabled={busy}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** A "Report a problem" button with its own dialog, for server-rendered pages such as the results. */
export function ReportButton({ sessionId, position, reported }: { sessionId: string; position: number; reported: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(reported);
  return (
    <>
      <button type="button" className={`btn btn-ghost !min-h-10 !px-3 !py-1 text-sm ${done ? "!border-accent !text-accent" : ""}`} onClick={() => setOpen(true)}>
        {done ? "Reported" : "Report a problem"}
      </button>
      {open && <ReportDialog sessionId={sessionId} position={position} revealed alreadyReported={done} onClose={() => setOpen(false)} onSent={() => setDone(true)} />}
    </>
  );
}
