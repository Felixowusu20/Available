import { db } from "@/lib/db";
import { pct } from "@/lib/practice/scoring";

export type WeakTopic = { discipline: string; subtopic: string | null; answered: number; correct: number; accuracy: number };

export type Dashboard = {
  sessionsFinished: number;
  overall: { answered: number; correct: number; accuracy: number };
  seen: { seen: number; total: number; bySection: Record<"PRECLINICAL" | "CLINICAL", { seen: number; total: number }> };
  trend: { id: string; at: Date; pct: number; kind: string }[];
  weakDisciplines: WeakTopic[];
  weakSubtopics: WeakTopic[];
  recent: { id: string; kind: string; mode: string; startedAt: Date; finished: boolean; questionCount: number; correct: number | null }[];
};

const MIN_DISCIPLINE = 5; // answers needed before a discipline is called "weak"
const MIN_SUBTOPIC = 3;

type TopicRow = { discipline: string; subtopic: string; answered: bigint; correct: bigint };

export async function getDashboard(userId: string): Promise<Dashboard> {
  const [finished, recent, topicRows, seenRows, totals] = await Promise.all([
    db.practiceSession.findMany({
      where: { userId, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      take: 20,
      select: { id: true, kind: true, finishedAt: true, questionCount: true, correctCount: true },
    }),
    db.practiceSession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, kind: true, mode: true, startedAt: true, finishedAt: true, questionCount: true, correctCount: true },
    }),
    // Per-topic accuracy over finished sessions only, so unfinished exams don't skew it.
    db.$queryRaw<TopicRow[]>`
      SELECT q."discipline", q."subtopic",
             COUNT(*) FILTER (WHERE a."selectedIndex" IS NOT NULL) AS answered,
             COUNT(*) FILTER (WHERE a."correct" = true) AS correct
      FROM "Answer" a
      JOIN "Question" q ON q."id" = a."questionId"
      JOIN "PracticeSession" s ON s."id" = a."sessionId"
      WHERE a."userId" = ${userId} AND s."finishedAt" IS NOT NULL
      GROUP BY q."discipline", q."subtopic"`,
    db.$queryRaw<{ section: "PRECLINICAL" | "CLINICAL"; seen: bigint }[]>`
      SELECT q."section", COUNT(DISTINCT a."questionId") AS seen
      FROM "Answer" a JOIN "Question" q ON q."id" = a."questionId"
      WHERE a."userId" = ${userId} AND a."selectedIndex" IS NOT NULL AND q."status" = 'PUBLISHED'
      GROUP BY q."section"`,
    db.question.groupBy({ by: ["section"], where: { status: "PUBLISHED" }, _count: true }),
  ]);

  // Aggregate rows into disciplines.
  const byDiscipline = new Map<string, { answered: number; correct: number }>();
  let answered = 0;
  let correct = 0;
  const subtopics: WeakTopic[] = [];
  for (const r of topicRows) {
    const a = Number(r.answered);
    const c = Number(r.correct);
    answered += a;
    correct += c;
    const d = byDiscipline.get(r.discipline) ?? { answered: 0, correct: 0 };
    d.answered += a;
    d.correct += c;
    byDiscipline.set(r.discipline, d);
    if (a >= MIN_SUBTOPIC) subtopics.push({ discipline: r.discipline, subtopic: r.subtopic, answered: a, correct: c, accuracy: pct(c, a) });
  }
  const disciplines: WeakTopic[] = [...byDiscipline]
    .filter(([, v]) => v.answered >= MIN_DISCIPLINE)
    .map(([discipline, v]) => ({ discipline, subtopic: null, answered: v.answered, correct: v.correct, accuracy: pct(v.correct, v.answered) }));
  const weakest = (list: WeakTopic[], n: number) => list.sort((x, y) => x.accuracy - y.accuracy || y.answered - x.answered).slice(0, n);

  const bySection = { PRECLINICAL: { seen: 0, total: 0 }, CLINICAL: { seen: 0, total: 0 } };
  for (const t of totals) bySection[t.section].total = t._count;
  for (const s of seenRows) bySection[s.section].seen = Number(s.seen);

  return {
    sessionsFinished: finished.length,
    overall: { answered, correct, accuracy: pct(correct, answered) },
    seen: {
      seen: bySection.PRECLINICAL.seen + bySection.CLINICAL.seen,
      total: bySection.PRECLINICAL.total + bySection.CLINICAL.total,
      bySection,
    },
    trend: finished
      .slice()
      .reverse()
      .map((s) => ({ id: s.id, at: s.finishedAt!, pct: pct(s.correctCount ?? 0, s.questionCount), kind: s.kind })),
    weakDisciplines: weakest(disciplines, 5),
    weakSubtopics: weakest(subtopics, 8),
    recent: recent.map((s) => ({
      id: s.id,
      kind: s.kind,
      mode: s.mode,
      startedAt: s.startedAt,
      finished: s.finishedAt !== null,
      questionCount: s.questionCount,
      correct: s.correctCount,
    })),
  };
}
