"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Tree = Record<"PRECLINICAL" | "CLINICAL", Record<string, string[]>>;
export type QuestionFormValues = {
  id?: string;
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  section: "PRECLINICAL" | "CLINICAL" | "";
  discipline: string;
  subtopic: string;
  difficulty: "" | "EASY" | "MEDIUM" | "HARD";
  source: string;
  status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED";
};

export const emptyQuestion: QuestionFormValues = {
  stem: "",
  options: ["", "", "", ""],
  correctIndex: 0,
  explanation: "",
  section: "",
  discipline: "",
  subtopic: "",
  difficulty: "",
  source: "",
  status: "DRAFT",
};

export function QuestionForm({ initial, tree }: { initial: QuestionFormValues; tree: Tree }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof QuestionFormValues>(k: K, val: QuestionFormValues[K]) => {
    setSaved(false);
    setV((p) => ({ ...p, [k]: val }));
  };
  const disciplines = v.section ? Object.keys(tree[v.section]) : [];
  const subtopics = v.section && v.discipline ? (tree[v.section][v.discipline] ?? []) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    const body = {
      stem: v.stem,
      options: v.options,
      correctIndex: v.correctIndex,
      explanation: v.explanation,
      section: v.section || null,
      discipline: v.discipline || null,
      subtopic: v.subtopic || null,
      difficulty: v.difficulty || null,
      source: v.source || null,
      status: v.status,
    };
    try {
      const res = await fetch(v.id ? `/api/admin/questions/${v.id}` : "/api/admin/questions", {
        method: v.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data?.issues ? data.issues.map((i: { path: string; message: string }) => `${i.path ? i.path + ": " : ""}${i.message}`) : [data?.error ?? "Could not save."]);
        return;
      }
      if (!v.id) router.replace(`/admin/questions/${data.id}`);
      else {
        setSaved(true);
        router.refresh();
      }
    } catch {
      setErrors(["Network problem. Try again."]);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!v.id || !confirm("Delete this question permanently?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/questions/${v.id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/questions");
    else {
      setErrors([(await res.json().catch(() => ({}))).error ?? "Could not delete."]);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="stem" className="mb-1 block text-sm font-medium">
          Question
        </label>
        <textarea id="stem" className="input min-h-32" value={v.stem} onChange={(e) => set("stem", e.target.value)} required />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Options (select the correct one)</legend>
        {v.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="radio" name="correct" className="size-5 shrink-0" checked={v.correctIndex === i} onChange={() => set("correctIndex", i)} aria-label={`Option ${"ABCD"[i]} is correct`} />
            <span className="w-5 text-sm font-semibold">{"ABCD"[i]}</span>
            <input className="input" value={o} onChange={(e) => set("options", v.options.map((x, j) => (j === i ? e.target.value : x)))} required aria-label={`Option ${"ABCD"[i]}`} />
          </div>
        ))}
      </fieldset>

      <div>
        <label htmlFor="expl" className="mb-1 block text-sm font-medium">
          Explanation
        </label>
        <textarea id="expl" className="input min-h-28" value={v.explanation} onChange={(e) => set("explanation", e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Section</span>
          <select className="input" value={v.section} onChange={(e) => setV((p) => ({ ...p, section: e.target.value as QuestionFormValues["section"], discipline: "", subtopic: "" }))}>
            <option value="">Untagged</option>
            <option value="PRECLINICAL">Preclinical</option>
            <option value="CLINICAL">Clinical</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Discipline</span>
          <select className="input" value={v.discipline} disabled={!v.section} onChange={(e) => setV((p) => ({ ...p, discipline: e.target.value, subtopic: "" }))}>
            <option value="">Choose…</option>
            {disciplines.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Subtopic</span>
          <select className="input" value={v.subtopic} disabled={!v.discipline} onChange={(e) => set("subtopic", e.target.value)}>
            <option value="">Choose…</option>
            {subtopics.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Difficulty</span>
          <select className="input" value={v.difficulty} onChange={(e) => set("difficulty", e.target.value as QuestionFormValues["difficulty"])}>
            <option value="">Not set</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Source</span>
          <input className="input" value={v.source} onChange={(e) => set("source", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Status</span>
          <select className="input" value={v.status} onChange={(e) => set("status", e.target.value as QuestionFormValues["status"])}>
            <option value="DRAFT">Draft</option>
            <option value="IN_REVIEW">In review</option>
            <option value="PUBLISHED">Published (visible to students)</option>
            <option value="RETIRED">Retired</option>
          </select>
        </label>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 rounded-lg bg-bad-bg p-3 pl-7 text-sm text-bad">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {saved && (
        <p role="status" className="rounded-lg bg-ok-bg p-3 text-sm text-ok">
          Saved.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button className="btn" disabled={busy}>
          {busy ? "Saving…" : v.id ? "Save changes" : "Create question"}
        </button>
        {v.id && (v.status === "DRAFT" || v.status === "RETIRED") && (
          <button type="button" className="btn btn-ghost !text-bad" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
