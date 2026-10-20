import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { QuestionInput } from "@/lib/question-schema";
import { contentHash, normaliseStem } from "@/lib/text";

/** Columns derived from the input; keep every write path going through this. */
export function derivedFields(q: Pick<QuestionInput, "stem">) {
  return { stemNorm: normaliseStem(q.stem), contentHash: contentHash(q.stem) };
}

/**
 * Inserts a question unless one with the same normalised stem already exists.
 * Returns whether it was created. Idempotent, so seeds and imports can be re-run.
 */
export async function insertQuestionIfNew(
  q: QuestionInput,
  opts: { createdById?: string | null } = {},
): Promise<{ created: boolean; id: string }> {
  const derived = derivedFields(q);
  const existing = await db.question.findUnique({ where: { contentHash: derived.contentHash }, select: { id: true } });
  if (existing) return { created: false, id: existing.id };

  const data: Prisma.QuestionUncheckedCreateInput = {
    stem: q.stem,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    section: q.section ?? null,
    discipline: q.discipline ?? null,
    subtopic: q.subtopic ?? null,
    difficulty: q.difficulty ?? null,
    source: q.source ?? null,
    status: q.status,
    highPriority: q.highPriority,
    legacyTopic: q.legacyTopic ?? null,
    createdById: opts.createdById ?? null,
    publishedAt: q.status === "PUBLISHED" ? new Date() : null,
    ...derived,
  };
  const row = await db.question.create({ data, select: { id: true } });
  return { created: true, id: row.id };
}
