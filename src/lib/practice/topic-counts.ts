// Pure helpers and types for the per-topic "questions left" numbers. Kept free of database imports so the
// practice screen (a client component) can use them.

/** `total` published questions in a topic; `left` of them the student has not answered yet. */
export type Count = { total: number; left: number };
export type Availability = {
  /** Keyed by discipline name, e.g. "Anatomy". */
  disciplines: Record<string, Count>;
  /** Keyed by `topicKey(discipline, subtopic)`. */
  subtopics: Record<string, Count>;
};

export const topicKey = (discipline: string, subtopic: string) => `${discipline}|${subtopic}`;

export type AvailabilityRow = { discipline: string; subtopic: string; total: bigint | number; seen: bigint | number };

/** Turns per-subtopic totals into per-subtopic and per-discipline counts. Pure, so it needs no database to test. */
export function rollUp(rows: AvailabilityRow[]): Availability {
  const out: Availability = { disciplines: {}, subtopics: {} };
  for (const r of rows) {
    const total = Number(r.total);
    const left = Math.max(0, total - Number(r.seen));
    out.subtopics[topicKey(r.discipline, r.subtopic)] = { total, left };
    const d = (out.disciplines[r.discipline] ??= { total: 0, left: 0 });
    d.total += total;
    d.left += left;
  }
  return out;
}
