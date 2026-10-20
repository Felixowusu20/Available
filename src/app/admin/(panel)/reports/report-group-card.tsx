"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { REASON_LABEL, REPORT_REASONS, type ReportReasonValue } from "@/lib/report-reasons";

const LETTERS = ["A", "B", "C", "D"];

export type GroupView = {
  question: { id: string; stem: string; options: string[]; correctIndex: number; explanation: string; status: string; discipline: string | null; subtopic: string | null };
  /** `when` is formatted on the server so it cannot differ between server and browser time zones. */
  reports: { id: string; reason: ReportReasonValue; comment: string; reporter: string; when: string }[];
};

export function ReportGroupCard({ g }: { g: GroupView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { question: q, reports } = g;

  async function close(outcome: "RESOLVED" | "DISMISSED") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/questions/${q.id}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.issues?.[0]?.message ?? data?.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  const counts = REPORT_REASONS.map((r) => [r, reports.filter((x) => x.reason === r).length] as const).filter(([, n]) => n > 0);

  return (
    <article className="card space-y-3 p-4" aria-label="Reported question">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-warn-bg px-1.5 py-0.5 font-medium text-warn">
          {reports.length} report{reports.length === 1 ? "" : "s"}
        </span>
        {counts.map(([r, n]) => (
          <span key={r} className="rounded bg-line px-1.5 py-0.5">
            {REASON_LABEL[r]}
            {n > 1 ? ` × ${n}` : ""}
          </span>
        ))}
        <span className="text-muted">
          · {q.status.replace("_", " ").toLowerCase()}
          {q.discipline ? ` · ${q.discipline} › ${q.subtopic}` : ""}
        </span>
      </div>

      <p className="whitespace-pre-line leading-relaxed">{q.stem}</p>
      <ul className="space-y-1 text-sm">
        {q.options.map((o, i) => (
          <li key={i} className={`rounded border p-2 ${i === q.correctIndex ? "border-ok bg-ok-bg" : "border-line"}`}>
            <strong>{LETTERS[i]}.</strong> {o}
            {i === q.correctIndex && " ✓ marked correct"}
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer underline">Explanation</summary>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{q.explanation || "No explanation."}</p>
      </details>

      <ul className="space-y-2" aria-label="Reports on this question">
        {reports.map((r) => (
          <li key={r.id} className="rounded bg-bg p-2 text-sm ring-1 ring-line">
            <p>
              <strong>{REASON_LABEL[r.reason]}</strong>
            </p>
            {r.comment && <p className="mt-1 whitespace-pre-line break-words">{r.comment}</p>}
            <p className="mt-1 break-all text-xs text-muted">
              {r.reporter} · {r.when}
            </p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t border-line pt-3">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Note for the record (optional)</span>
          <input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="What you changed, or why no change is needed" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/questions/${q.id}`} className="btn btn-ghost !min-h-10 !px-3 !py-1 text-sm">
            Edit question
          </Link>
          <button className="btn !min-h-10 !px-3 !py-1 text-sm" disabled={busy} onClick={() => void close("RESOLVED")}>
            Mark fixed
          </button>
          <button className="btn btn-ghost !min-h-10 !px-3 !py-1 text-sm" disabled={busy} onClick={() => void close("DISMISSED")}>
            No change needed
          </button>
        </div>
      </div>
    </article>
  );
}
