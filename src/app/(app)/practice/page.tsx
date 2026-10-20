import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { getAvailability } from "@/lib/practice/availability";
import { SECTIONS, taxonomy } from "@/lib/taxonomy";
import { StartPractice } from "./start-practice";

export const metadata = { title: "Practice" };

export default async function PracticePage() {
  const user = await requireUser();

  const [counts, bookmarkCount, answers, left] = await Promise.all([
    db.question.groupBy({ by: ["section"], where: { status: "PUBLISHED" }, _count: true }),
    db.bookmark.count({ where: { userId: user.id, question: { status: "PUBLISHED" } } }),
    db.answer.findMany({
      where: { userId: user.id, selectedIndex: { not: null } },
      orderBy: { answeredAt: "desc" },
      select: { questionId: true, correct: true },
    }),
    // The "questions left" counters are premium, so a free account is not even sent the numbers.
    user.premium ? getAvailability(user.id) : Promise.resolve({ disciplines: {}, subtopics: {} }),
  ]);
  const available = { PRECLINICAL: 0, CLINICAL: 0 };
  for (const c of counts) if (c.section) available[c.section] = c._count;

  const latest = new Map<string, boolean>();
  for (const a of answers) if (!latest.has(a.questionId)) latest.set(a.questionId, a.correct === true);
  const missedCount = [...latest.values()].filter((ok) => !ok).length;

  const tree = SECTIONS.map((section) => ({
    section,
    disciplines: Object.entries(taxonomy[section]).map(([name, subtopics]) => ({ name, subtopics })),
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Practice</h1>
        <p className="mt-1 text-sm text-muted">Timed mocks and topic practice. Only published questions are included.</p>
      </div>
      <StartPractice
        tree={tree}
        secondsPerQuestion={env().EXAM_SECONDS_PER_QUESTION}
        available={available}
        left={left}
        premium={user.premium}
        missedCount={missedCount}
        bookmarkCount={bookmarkCount}
      />
    </main>
  );
}
