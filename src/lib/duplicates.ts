import { db } from "@/lib/db";

export type NearDuplicate = { questionId: string; similarity: number };

/** Questions whose normalised stems are at least this similar (pg_trgm, 0-1) are flagged as likely duplicates. */
export const DUPLICATE_THRESHOLD = 0.8;

/**
 * For each normalised stem, the most similar existing question (or null if none reaches the
 * threshold). Uses the GIN trigram index on Question.stemNorm.
 */
export async function findNearDuplicates(norms: string[], threshold = DUPLICATE_THRESHOLD): Promise<(NearDuplicate | null)[]> {
  if (norms.length === 0) return [];
  const rows = await db.$queryRaw<{ idx: bigint; id: string; sim: number }[]>`
    SELECT t.idx, m.id, m.sim
    FROM unnest(${norms}::text[]) WITH ORDINALITY AS t(norm, idx)
    JOIN LATERAL (
      SELECT q."id", similarity(q."stemNorm", t.norm) AS sim
      FROM "Question" q
      WHERE q."stemNorm" % t.norm
      ORDER BY sim DESC
      LIMIT 1
    ) m ON true`;
  const out: (NearDuplicate | null)[] = norms.map(() => null);
  for (const r of rows) {
    if (r.sim >= threshold) out[Number(r.idx) - 1] = { questionId: r.id, similarity: Math.round(r.sim * 1000) / 1000 };
  }
  return out;
}

/** Existing questions similar to the given one (excluding itself), most similar first. */
export async function findSimilarTo(questionId: string, threshold = DUPLICATE_THRESHOLD, limit = 5): Promise<NearDuplicate[]> {
  const rows = await db.$queryRaw<{ id: string; sim: number }[]>`
    SELECT o."id", similarity(o."stemNorm", q."stemNorm") AS sim
    FROM "Question" q
    JOIN "Question" o ON o."id" <> q."id" AND o."stemNorm" % q."stemNorm"
    WHERE q."id" = ${questionId}
    ORDER BY sim DESC
    LIMIT ${limit}`;
  return rows.filter((r) => r.sim >= threshold).map((r) => ({ questionId: r.id, similarity: Math.round(r.sim * 1000) / 1000 }));
}
