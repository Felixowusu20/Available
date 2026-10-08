"use client";

import Link from "next/link";
import { useState } from "react";

type Row = { row: number; status: "ok" | "warning" | "error" | "duplicate" | "similar"; messages: string[]; stemPreview: string; tagged: boolean };
type Preview = { rows: Row[]; totals: { total: number; importable: number; errors: number; duplicates: number; similar: number; untagged: number } };
type Result = { created: number; ids: string[]; untaggedIds: string[]; skipped: { errors: number; duplicates: number; similar: number } };

const BADGE: Record<Row["status"], string> = {
  ok: "bg-ok-bg text-ok",
  warning: "bg-warn-bg text-warn",
  similar: "bg-warn-bg text-warn",
  duplicate: "bg-line text-muted",
  error: "bg-bad-bg text-bad",
};

export function ImportClient({ aiAvailable }: { aiAvailable: boolean }) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | undefined>();
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [skipSimilar, setSkipSimilar] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "commit" | "ai">(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFilename(file.name);
    setFormat(file.name.toLowerCase().endsWith(".csv") ? "csv" : "json");
    setText(await file.text());
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function call(mode: "preview" | "commit") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, format, text, filename, skipSimilar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? data?.issues?.[0]?.message ?? "Import failed.");
        return;
      }
      if (mode === "preview") setPreview(data);
      else {
        setResult(data);
        setPreview(null);
      }
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function tagWithAi(ids: string[]) {
    setBusy("ai");
    setAiMsg(null);
    try {
      const res = await fetch("/api/admin/ai/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "tag", ids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "AI run failed");
      setAiMsg(`AI tagging finished: ${data.succeeded} suggested, ${data.failed} failed.`);
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : "AI run failed");
    } finally {
      setBusy(null);
    }
  }

  const rows = preview ? (onlyProblems ? preview.rows.filter((r) => r.status !== "ok") : preview.rows) : [];

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">File (.json or .csv)</span>
            <input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Format</span>
            <select className="input !w-28" value={format} onChange={(e) => setFormat(e.target.value as "json" | "csv")}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">…or paste the content</span>
          <textarea
            className="input min-h-32 font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setResult(null);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={skipSimilar} onChange={(e) => setSkipSimilar(e.target.checked)} />
          Skip questions that look like near-duplicates of existing ones
        </label>
        <button className="btn" disabled={!text.trim() || busy !== null} onClick={() => call("preview")}>
          {busy === "preview" ? "Checking…" : "Check file"}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-bad-bg p-3 text-sm text-bad">
          {error}
        </p>
      )}

      {preview && (
        <section className="card space-y-3 p-4" aria-label="Preview">
          <p className="text-sm">
            <strong>{preview.totals.importable}</strong> of {preview.totals.total} rows can be imported.{" "}
            {preview.totals.errors > 0 && <span className="text-bad">{preview.totals.errors} have errors. </span>}
            {preview.totals.duplicates > 0 && <span className="text-muted">{preview.totals.duplicates} duplicates will be skipped. </span>}
            {preview.totals.similar > 0 && <span className="text-warn">{preview.totals.similar} look similar to existing questions. </span>}
            {preview.totals.untagged > 0 && <span className="text-muted">{preview.totals.untagged} will be untagged.</span>}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows needing attention
          </label>
          <div className="max-h-96 overflow-auto rounded border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted">
                <tr>
                  <th className="p-2">Row</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Question and notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.row} className="align-top">
                    <td className="p-2">{r.row}</td>
                    <td className="p-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="p-2">
                      <p>{r.stemPreview || <em className="text-muted">(no text)</em>}</p>
                      {r.messages.map((m) => (
                        <p key={m} className={`text-xs ${r.status === "error" ? "text-bad" : "text-muted"}`}>
                          {m}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn" disabled={preview.totals.importable === 0 || busy !== null} onClick={() => call("commit")}>
            {busy === "commit" ? "Importing…" : `Import ${preview.totals.importable - (skipSimilar ? preview.totals.similar : 0)} as drafts`}
          </button>
        </section>
      )}

      {result && (
        <section className="card space-y-3 border-ok p-4" aria-label="Import result" role="status">
          <p className="font-semibold text-ok">Imported {result.created} question{result.created === 1 ? "" : "s"} as drafts.</p>
          <p className="text-sm text-muted">
            Skipped: {result.skipped.errors} with errors, {result.skipped.duplicates} duplicates, {result.skipped.similar} similar.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/questions?status=DRAFT" className="btn">
              Review drafts
            </Link>
            {result.untaggedIds.length > 0 && (
              <button className="btn btn-ghost" disabled={!aiAvailable || busy !== null} onClick={() => tagWithAi(result.untaggedIds)} title={aiAvailable ? undefined : "AI is unavailable: no API key is configured"}>
                {busy === "ai" ? "Tagging…" : aiAvailable ? `AI-tag ${result.untaggedIds.length} untagged` : "AI tagging unavailable"}
              </button>
            )}
          </div>
          {aiMsg && <p className="text-sm">{aiMsg} Review the results under AI review.</p>}
        </section>
      )}
    </div>
  );
}
