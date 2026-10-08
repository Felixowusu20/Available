export type ResultRow = {
  position: number;
  blockIndex: number;
  section: "PRECLINICAL" | "CLINICAL";
  discipline: string;
  subtopic: string;
  answered: boolean;
  correct: boolean;
  guessed: boolean;
};

export type Tally = { total: number; answered: number; correct: number };
export type TopicTally = Tally & { key: string; discipline: string; subtopic: string | null; section: "PRECLINICAL" | "CLINICAL"; accuracy: number };

export type Summary = {
  total: number;
  answered: number;
  correct: number;
  scorePct: number;
  /** Guessed answers are reported on their own so students can see how much of the score was luck. */
  guessed: { count: number; correct: number };
  confident: { count: number; correct: number };
  bySection: Record<"PRECLINICAL" | "CLINICAL", Tally>;
  byBlock: (Tally & { block: number })[];
  byDiscipline: TopicTally[];
  bySubtopic: TopicTally[];
};

const empty = (): Tally => ({ total: 0, answered: 0, correct: 0 });
const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

function add(t: Tally, r: ResultRow) {
  t.total++;
  if (r.answered) t.answered++;
  if (r.correct) t.correct++;
}

/** Weakest first: lowest accuracy, then the topic with more questions (more evidence). */
function weakestFirst(list: TopicTally[]): TopicTally[] {
  return list.sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || a.key.localeCompare(b.key));
}

export function summarise(rows: ResultRow[]): Summary {
  const overall = empty();
  const bySection = { PRECLINICAL: empty(), CLINICAL: empty() };
  const blocks = new Map<number, Tally>();
  const disciplines = new Map<string, TopicTally>();
  const subtopics = new Map<string, TopicTally>();
  const guessed = { count: 0, correct: 0 };
  const confident = { count: 0, correct: 0 };

  for (const r of rows) {
    add(overall, r);
    add(bySection[r.section], r);
    if (!blocks.has(r.blockIndex)) blocks.set(r.blockIndex, empty());
    add(blocks.get(r.blockIndex)!, r);

    const dKey = r.discipline;
    if (!disciplines.has(dKey)) disciplines.set(dKey, { ...empty(), key: dKey, discipline: r.discipline, subtopic: null, section: r.section, accuracy: 0 });
    add(disciplines.get(dKey)!, r);

    const sKey = `${r.discipline} / ${r.subtopic}`;
    if (!subtopics.has(sKey)) subtopics.set(sKey, { ...empty(), key: sKey, discipline: r.discipline, subtopic: r.subtopic, section: r.section, accuracy: 0 });
    add(subtopics.get(sKey)!, r);

    if (r.answered) {
      const bucket = r.guessed ? guessed : confident;
      bucket.count++;
      if (r.correct) bucket.correct++;
    }
  }

  const finish = (m: Map<string, TopicTally>) => weakestFirst([...m.values()].map((t) => ({ ...t, accuracy: pct(t.correct, t.total) })));

  return {
    total: overall.total,
    answered: overall.answered,
    correct: overall.correct,
    scorePct: pct(overall.correct, overall.total),
    guessed,
    confident,
    bySection,
    byBlock: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([block, t]) => ({ block, ...t })),
    byDiscipline: finish(disciplines),
    bySubtopic: finish(subtopics),
  };
}

export { pct };
