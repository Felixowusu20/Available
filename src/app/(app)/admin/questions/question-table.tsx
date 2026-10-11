"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeTotals, runAiInChunks } from "@/lib/ai/run-client";

type Item = {
  id: string;
  stem: string;
  status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED";
  section: string | null;
  discipline: string | null;
  subtopic: string | null;
  pendingAi: number;
  openReports: number;
};

const STATUS_STYLE: Record<Item["status"], string> = {
  DRAFT: "bg-warn-bg text-warn",
  IN_REVIEW: "bg-accent/15 text-accent",
  PUBLISHED: "bg-ok-bg text-ok",
  RETIRED: "bg-line text-muted",
};

export function QuestionTable({ items }: { items: Item[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulk(status: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/questions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.issues?.[0]?.message ?? data?.error ?? "Failed");
      setMsg(`${data.updated} updated${data.skippedUntagged ? `, ${data.skippedUntagged} skipped because they are untagged` : ""}.`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAi(kind: "tag" | "quality") {
    setBusy(true);
    setMsg(null);
    const totals = await runAiInChunks(kind, [...selected], (p) => setMsg(`Running AI… ${p.done} of ${p.total} questions`));
    setMsg(`${describeTotals(totals)} Review them under AI review.`);
    setSelected(new Set());
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 p-3 text-sm" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => bulk("IN_REVIEW")}>
            Send to review
          </button>
          <button className="btn !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => bulk("PUBLISHED")}>
            Publish
          </button>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => bulk("RETIRED")}>
            Retire
          </button>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => bulk("DRAFT")}>
            Back to draft
          </button>
          <span className="mx-1 text-muted">|</span>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => runAi("tag")}>
            AI tag
          </button>
          <button className="btn btn-ghost !min-h-9 !px-3 !py-1" disabled={busy} onClick={() => runAi("quality")}>
            AI quality check
          </button>
        </div>
      )}
      {msg && (
        <p role="status" className="rounded-lg bg-card p-3 text-sm ring-1 ring-line">
          {msg}
        </p>
      )}

      <div className="card overflow-hidden">
        <label className="flex min-h-11 items-center gap-3 border-b border-line px-3 text-sm text-muted">
          <input type="checkbox" className="size-5" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} />
          Select all on this page
        </label>
        {items.length === 0 && <p className="p-4 text-muted">No questions match.</p>}
        <ul className="divide-y divide-line">
          {items.map((q) => (
            <li key={q.id} className="flex items-start gap-3 p-3">
              <input type="checkbox" className="mt-1 size-5 shrink-0" checked={selected.has(q.id)} onChange={() => toggle(q.id)} aria-label="Select question" />
              <Link href={`/admin/questions/${q.id}`} className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm">{q.stem}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[q.status]}`}>{q.status.replace("_", " ").toLowerCase()}</span>
                  {q.discipline ? (
                    <span>
                      {q.discipline} › {q.subtopic}
                    </span>
                  ) : (
                    <span className="text-warn">untagged</span>
                  )}
                  {q.pendingAi > 0 && <span className="text-accent">{q.pendingAi} AI suggestion{q.pendingAi === 1 ? "" : "s"}</span>}
                  {q.openReports > 0 && <span className="font-medium text-warn">{q.openReports} open report{q.openReports === 1 ? "" : "s"}</span>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
