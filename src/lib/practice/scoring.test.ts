import { describe, expect, it } from "vitest";
import { summarise, type ResultRow } from "./scoring";
import { GRACE_MS, deadlineOf, isExpired, isPastGrace } from "./timing";

const row = (over: Partial<ResultRow>): ResultRow => ({
  position: 0,
  blockIndex: 0,
  section: "PRECLINICAL",
  discipline: "Anatomy",
  subtopic: "Thorax",
  answered: true,
  correct: true,
  guessed: false,
  ...over,
});

describe("summarise", () => {
  const rows: ResultRow[] = [
    row({ position: 0, correct: true }),
    row({ position: 1, correct: false, guessed: true }),
    row({ position: 2, correct: true, guessed: true, discipline: "Physiology", subtopic: "Renal and acid-base" }),
    row({ position: 3, section: "CLINICAL", discipline: "Surgery", subtopic: "Trauma", correct: false }),
    row({ position: 4, blockIndex: 1, section: "CLINICAL", discipline: "Surgery", subtopic: "Trauma", answered: false, correct: false }),
  ];
  const s = summarise(rows);

  it("scores over all questions, counting unanswered as wrong", () => {
    expect(s.total).toBe(5);
    expect(s.answered).toBe(4);
    expect(s.correct).toBe(2);
    expect(s.scorePct).toBe(40);
  });

  it("splits by section and block", () => {
    expect(s.bySection.PRECLINICAL).toEqual({ total: 3, answered: 3, correct: 2 });
    expect(s.bySection.CLINICAL).toEqual({ total: 2, answered: 1, correct: 0 });
    expect(s.byBlock.map((b) => [b.block, b.total, b.correct])).toEqual([[0, 4, 2], [1, 1, 0]]);
  });

  it("reports guesses separately from confident answers", () => {
    expect(s.guessed).toEqual({ count: 2, correct: 1 });
    expect(s.confident).toEqual({ count: 2, correct: 1 });
  });

  it("lists the weakest topics first", () => {
    expect(s.byDiscipline[0].discipline).toBe("Surgery");
    expect(s.byDiscipline[0].accuracy).toBe(0);
    expect(s.bySubtopic.map((t) => t.key)[0]).toBe("Surgery / Trauma");
    expect(s.byDiscipline.at(-1)!.discipline).toBe("Physiology");
  });

  it("handles an empty session", () => {
    expect(summarise([]).scorePct).toBe(0);
  });
});

describe("timing", () => {
  const start = new Date("2026-01-01T10:00:00Z");
  it("computes deadline and expiry", () => {
    expect(deadlineOf(start, 60)!.toISOString()).toBe("2026-01-01T10:01:00.000Z");
    expect(deadlineOf(start, null)).toBeNull();
    expect(isExpired(start, 60, start.getTime() + 59_000)).toBe(false);
    expect(isExpired(start, 60, start.getTime() + 61_000)).toBe(true);
    expect(isExpired(start, null, start.getTime() + 1e12)).toBe(false);
  });
  it("tolerates a short grace period for late writes", () => {
    expect(isPastGrace(start, 60, start.getTime() + 60_000 + GRACE_MS - 1)).toBe(false);
    expect(isPastGrace(start, 60, start.getTime() + 60_000 + GRACE_MS + 1)).toBe(true);
  });
});
