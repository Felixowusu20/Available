import { db } from "@/lib/db";
import { findNearDuplicates } from "@/lib/duplicates";
import type { ParsedRow } from "@/lib/admin/import";
import { derivedFields } from "@/lib/question-store";
import { normaliseStem } from "@/lib/text";

export type PreviewStatus = "ok" | "warning" | "error" | "duplicate" | "similar";

export type PreviewRow = {
  row: number;
  status: PreviewStatus;
  messages: string[];
  stemPreview: string;
  tagged: boolean;
  similarTo?: { questionId: string; similarity: number };
};

export type Preview = {
  rows: PreviewRow[];
  totals: { total: number; importable: number; errors: number; duplicates: number; similar: number; untagged: number };
};

/**
 * Classifies each parsed row against the file itself and the existing bank:
 *  - error:     invalid, will not be imported
 *  - duplicate: same normalised stem already exists (or appears earlier in this file); skipped
 *  - similar:   a near-duplicate (pg_trgm) exists; imported unless the admin chose to skip these
 *  - warning/ok: importable
 */
export async function previewRows(rows: ParsedRow[]): Promise<Preview> {
  const valid = rows.filter((r) => r.input);
  const hashes = valid.map((r) => derivedFields(r.input!).contentHash);
  const existing = await db.question.findMany({ where: { contentHash: { in: hashes } }, select: { contentHash: true } });
  const existingSet = new Set(existing.map((e) => e.contentHash));

  const seenInFile = new Set<string>();
  const dupFlags = new Map<number, string>();
  valid.forEach((r, i) => {
    const h = hashes[i];
    if (existingSet.has(h)) dupFlags.set(r.row, "Already in the question bank");
    else if (seenInFile.has(h)) dupFlags.set(r.row, "Repeated earlier in this file");
    seenInFile.add(h);
  });

  const toCheck = valid.filter((r) => !dupFlags.has(r.row));
  const near = await findNearDuplicates(toCheck.map((r) => normaliseStem(r.input!.stem)));
  const nearByRow = new Map(toCheck.map((r, i) => [r.row, near[i]]));

  const out: PreviewRow[] = rows.map((r) => {
    const base = { row: r.row, stemPreview: r.stemPreview, tagged: !!r.input?.section };
    if (!r.input) return { ...base, status: "error", messages: r.errors };
    const dup = dupFlags.get(r.row);
    if (dup) return { ...base, status: "duplicate", messages: [dup, ...r.warnings] };
    const n = nearByRow.get(r.row);
    if (n) return { ...base, status: "similar", messages: [`Looks ${Math.round(n.similarity * 100)}% similar to an existing question`, ...r.warnings], similarTo: n };
    return { ...base, status: r.warnings.length ? "warning" : "ok", messages: r.warnings };
  });

  const count = (s: PreviewStatus) => out.filter((r) => r.status === s).length;
  return {
    rows: out,
    totals: {
      total: out.length,
      importable: count("ok") + count("warning") + count("similar"),
      errors: count("error"),
      duplicates: count("duplicate"),
      similar: count("similar"),
      untagged: out.filter((r) => r.status !== "error" && r.status !== "duplicate" && !r.tagged).length,
    },
  };
}

/** Inserts importable rows as DRAFT. Re-validates everything server-side; the client's preview is never trusted. */
export async function commitRows(adminId: string, rows: ParsedRow[], opts: { skipSimilar: boolean; defaultSource: string | null }) {
  const preview = await previewRows(rows);
  const statusByRow = new Map(preview.rows.map((p) => [p.row, p.status]));
  const toInsert = rows.filter((r) => {
    const s = statusByRow.get(r.row);
    return r.input && (s === "ok" || s === "warning" || (s === "similar" && !opts.skipSimilar));
  });

  const data = toInsert.map((r) => {
    const q = r.input!;
    return {
      stem: q.stem,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      section: q.section ?? null,
      discipline: q.discipline ?? null,
      subtopic: q.subtopic ?? null,
      difficulty: q.difficulty ?? null,
      source: q.source ?? opts.defaultSource,
      status: "DRAFT" as const,
      highPriority: q.highPriority,
      createdById: adminId,
      ...derivedFields(q),
    };
  });

  const res = await db.question.createMany({ data, skipDuplicates: true });
  const created = await db.question.findMany({ where: { contentHash: { in: data.map((d) => d.contentHash) }, createdById: adminId }, select: { id: true, section: true }, orderBy: { createdAt: "desc" }, take: data.length });

  return {
    created: res.count,
    ids: created.map((c) => c.id),
    untaggedIds: created.filter((c) => !c.section).map((c) => c.id),
    skipped: {
      errors: preview.totals.errors,
      duplicates: preview.totals.duplicates,
      similar: opts.skipSimilar ? preview.totals.similar : 0,
    },
  };
}
