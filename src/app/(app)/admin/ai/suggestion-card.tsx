"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Tree = Record<"PRECLINICAL" | "CLINICAL", Record<string, string[]>>;
type Section = "PRECLINICAL" | "CLINICAL";

export type SuggestionView = {
  id: string;
  kind: "TAG" | "QUALITY";
  model: string;
  question: { id: string; stem: string; explanation: string; status: string; section: Section | null; discipline: string | null; subtopic: string | null };
  suggested: { section: Section; discipline: string; subtopic: string; difficulty: string | null } | null;
  confidence: number | null;
  flags: { code: string; note: string }[];
  draftedExplanation: string | null;
  duplicates: { questionId: string; similarity: number; preview: string }[];
};

const FLAG_LABEL: Record<string, string> = {
  ANSWER_KEY_SUSPECT: "Answer key looks wrong",
  MULTIPLE_DEFENSIBLE: "More than one defensible answer",
  WEAK_EXPLANATION: "Missing or weak explanation",
  UNSAFE_OR_OUTDATED_DRUG_INFO: "Unsafe or outdated drug information",
};

const tags = (t: { discipline: string | null; subtopic: string | null } | null) => (t?.discipline ? `${t.discipline} › ${t.subtopic}` : "Untagged");

export function SuggestionCard({ s, tree }: { s: SuggestionView; tree: Tree }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [useDraft, setUseDraft] = useState(!s.question.explanation.trim());

  const [section, setSection] = useState<Section | "">(s.suggested?.section ?? s.question.section ?? "");
  const [discipline, setDiscipline] = useState(s.suggested?.discipline ?? s.question.discipline ?? "");
  const [subtopic, setSubtopic] = useState(s.suggested?.subtopic ?? s.question.subtopic ?? "");
  const [explanation, setExplanation] = useState(s.draftedExplanation ?? s.question.explanation);

  async function act(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ai/suggestions/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.issues?.[0]?.message ?? data?.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  const low = s.confidence !== null && s.confidence < 0.6;

  return (
    <article className="card space-y-3 p-4" aria-label="AI suggestion">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">{s.kind === "TAG" ? "Tagging" : "Quality check"}</span>
        <span className="font-mono text-muted">{s.model}</span>
        <span className="text-muted">· question is {s.question.status.replace("_", " ").toLowerCase()}</span>
      </div>

      <Link href={`/admin/questions/${s.question.id}`} className="line-clamp-3 text-sm underline-offset-2 hover:underline">
        {s.question.stem}
      </Link>

      {s.suggested && (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Current</p>
            <p>{tags(s.question)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Suggested{s.suggested.difficulty ? ` · ${s.suggested.difficulty.toLowerCase()}` : ""}</p>
            <p className="font-medium">
              {s.suggested.section === "PRECLINICAL" ? "Preclinical" : "Clinical"} · {tags(s.suggested)}
            </p>
            {s.confidence !== null && (
              <p className={`text-xs ${low ? "text-warn" : "text-muted"}`}>
                Confidence {Math.round(s.confidence * 100)}%{low ? " (low, check carefully)" : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {s.flags.length > 0 && (
        <ul className="space-y-1" aria-label="Flags">
          {s.flags.map((f, i) => (
            <li key={i} className="rounded bg-warn-bg p-2 text-sm text-warn">
              <strong>{FLAG_LABEL[f.code] ?? f.code}.</strong> {f.note}
            </li>
          ))}
        </ul>
      )}
      {s.kind === "QUALITY" && s.flags.length === 0 && <p className="text-sm text-ok">No problems found.</p>}

      {s.draftedExplanation && (
        <details className="rounded border border-line p-2 text-sm" open={!s.question.explanation.trim()}>
          <summary className="cursor-pointer font-medium">Drafted explanation {s.question.explanation.trim() ? "(replaces the existing one if you tick the box)" : ""}</summary>
          <p className="mt-2 whitespace-pre-line leading-relaxed">{s.draftedExplanation}</p>
          {s.question.explanation.trim() && (
            <p className="mt-2 border-t border-line pt-2 text-muted">
              <span className="text-xs">Existing:</span>
              <br />
              <span className="whitespace-pre-line">{s.question.explanation}</span>
            </p>
          )}
        </details>
      )}

      {s.duplicates.length > 0 && (
        <div className="rounded bg-warn-bg p-2 text-sm text-warn" role="note">
          Possible duplicates:
          <ul className="mt-1 list-disc pl-5">
            {s.duplicates.map((d) => (
              <li key={d.questionId}>
                <Link href={`/admin/questions/${d.questionId}`} className="underline">
                  {Math.round(d.similarity * 100)}%
                </Link>{" "}
                {d.preview}…
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Section</span>
              <select className="input" value={section} onChange={(e) => { setSection(e.target.value as Section | ""); setDiscipline(""); setSubtopic(""); }}>
                <option value="">Untagged</option>
                <option value="PRECLINICAL">Preclinical</option>
                <option value="CLINICAL">Clinical</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Discipline</span>
              <select className="input" value={discipline} disabled={!section} onChange={(e) => { setDiscipline(e.target.value); setSubtopic(""); }}>
                <option value="">Choose…</option>
                {section && Object.keys(tree[section]).map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Subtopic</span>
              <select className="input" value={subtopic} disabled={!discipline} onChange={(e) => setSubtopic(e.target.value)}>
                <option value="">Choose…</option>
                {section && discipline && (tree[section][discipline] ?? []).map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Explanation</span>
            <textarea className="input min-h-24" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={() => act({ action: "edit", section: section || null, discipline: discipline || null, subtopic: subtopic || null, explanation: explanation || null })}>
              Save edits
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-bad-bg p-2 text-sm text-bad">
          {error}
        </p>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn !min-h-10" disabled={busy} onClick={() => act({ action: "accept", applyTags: true, applyExplanation: useDraft })}>
            Accept
          </button>
          <button className="btn btn-ghost !min-h-10" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="btn btn-ghost !min-h-10" disabled={busy} onClick={() => act({ action: "reject" })}>
            Reject
          </button>
          {s.draftedExplanation && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} /> Use drafted explanation
            </label>
          )}
        </div>
      )}
    </article>
  );
}
