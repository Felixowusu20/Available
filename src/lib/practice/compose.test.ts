import { describe, expect, it } from "vitest";
import { composeList, composeMock, NotEnoughQuestionsError, randomOptionOrder, type PoolItem } from "./compose";

const pool = (pre: number, cli: number): PoolItem[] => [
  ...Array.from({ length: pre }, (_, i) => ({ id: `p${i}`, section: "PRECLINICAL" as const })),
  ...Array.from({ length: cli }, (_, i) => ({ id: `c${i}`, section: "CLINICAL" as const })),
];
const sectionOf = (id: string) => (id.startsWith("p") ? "PRECLINICAL" : "CLINICAL");

describe("composeMock", () => {
  for (const size of [50, 100, 200] as const) {
    it(`builds a ${size}-question mock: half/half and 25/25 in every block of 50`, () => {
      const out = composeMock(pool(150, 150), size, new Set());
      expect(out).toHaveLength(size);
      expect(new Set(out.map((o) => o.questionId)).size).toBe(size); // no repeats
      expect(out.map((o) => o.position)).toEqual(Array.from({ length: size }, (_, i) => i));
      for (let b = 0; b < size / 50; b++) {
        const block = out.filter((o) => o.blockIndex === b);
        expect(block).toHaveLength(50);
        expect(block.filter((o) => sectionOf(o.questionId) === "PRECLINICAL")).toHaveLength(25);
        expect(block.filter((o) => sectionOf(o.questionId) === "CLINICAL")).toHaveLength(25);
      }
    });
  }

  it("mixes the sections within a block rather than grouping them", () => {
    const out = composeMock(pool(100, 100), 50, new Set(), () => 0.3);
    const first25 = out.slice(0, 25).map((o) => sectionOf(o.questionId));
    expect(new Set(first25).size).toBe(2);
  });

  it("prefers unseen questions", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => `p${i}`));
    const out = composeMock(pool(100, 100), 50, seen);
    const pre = out.filter((o) => sectionOf(o.questionId) === "PRECLINICAL");
    expect(pre.every((o) => !seen.has(o.questionId))).toBe(true);
  });

  it("falls back to seen questions when there are not enough unseen ones", () => {
    const seen = new Set(Array.from({ length: 95 }, (_, i) => `p${i}`));
    const out = composeMock(pool(100, 100), 100, seen);
    expect(out).toHaveLength(100);
    expect(out.filter((o) => o.questionId.startsWith("p") && !seen.has(o.questionId))).toHaveLength(5);
  });

  it("refuses when a section is short", () => {
    expect(() => composeMock(pool(30, 200), 100, new Set())).toThrow(NotEnoughQuestionsError);
  });
});

/** Small seeded generator so the spread checks below do not depend on luck. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("high-priority questions in a mock", () => {
  // The first `n` preclinical and the first `n` clinical questions (p0..p{n-1}, c0..c{n-1}) are high priority.
  const withPriority = (n: number): PoolItem[] => pool(100, 100).map((p) => ({ ...p, highPriority: Number(p.id.slice(1)) < n }));
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("includes every unseen high-priority question before ordinary ones", () => {
    // A 50-question mock needs 25 of each section, and 20 of each are high priority.
    const ids = new Set(composeMock(withPriority(20), 50, new Set(), seeded(1)).map((o) => o.questionId));
    expect(range(20).every((i) => ids.has(`p${i}`) && ids.has(`c${i}`))).toBe(true);
  });

  it("spreads priority questions across the blocks instead of filling the first one", () => {
    const out = composeMock(withPriority(50), 100, new Set(), seeded(7));
    const high = (b: number) => out.filter((o) => o.blockIndex === b && Number(o.questionId.slice(1)) < 50).length;
    expect(high(0) + high(1)).toBe(100); // every priority question is used
    expect(high(0)).toBeGreaterThan(30);
    expect(high(1)).toBeGreaterThan(30);
  });

  it("still prefers an unseen ordinary question over a seen high-priority one", () => {
    const seenHigh = new Set(range(20).map((i) => `p${i}`));
    const out = composeMock(withPriority(20), 50, seenHigh, seeded(3));
    expect(out.some((o) => seenHigh.has(o.questionId))).toBe(false);
  });

  it("repeats seen high-priority questions before seen ordinary ones when it has to repeat", () => {
    // All 100 preclinical questions have been seen and 10 are high priority; a 100-question mock needs 50.
    const seenAll = new Set(range(100).map((i) => `p${i}`));
    const ids = new Set(composeMock(withPriority(10), 100, seenAll, seeded(5)).map((o) => o.questionId));
    expect(range(10).every((i) => ids.has(`p${i}`))).toBe(true);
  });
});

describe("composeList", () => {
  it("draws unseen high-priority questions first", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, highPriority: i < 6 }));
    for (let run = 0; run < 20; run++) {
      const ids = new Set(composeList(items, 10, new Set(), seeded(run + 11)).map((o) => o.questionId));
      expect([0, 1, 2, 3, 4, 5].every((i) => ids.has(`q${i}`))).toBe(true);
    }
  });
  it("does not let a seen high-priority question beat an unseen ordinary one", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, highPriority: i < 4 }));
    const seen = new Set(["q0", "q1", "q2", "q3"]);
    const out = composeList(items, 8, seen, seeded(2));
    expect(out.some((o) => seen.has(o.questionId))).toBe(false);
  });
  it("returns at most `count` unique questions, unseen first", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}` }));
    const seen = new Set(items.slice(0, 20).map((i) => i.id));
    const out = composeList(items, 10, seen);
    expect(out).toHaveLength(10);
    expect(out.every((o) => !seen.has(o.questionId))).toBe(true);
  });
  it("caps at the pool size and rejects an empty pool", () => {
    expect(composeList([{ id: "a" }, { id: "b" }], 10, new Set())).toHaveLength(2);
    expect(() => composeList([], 10, new Set())).toThrow(NotEnoughQuestionsError);
  });
});

describe("randomOptionOrder", () => {
  it("is a permutation of 0..3", () => {
    for (let i = 0; i < 50; i++) expect([...randomOptionOrder()].sort()).toEqual([0, 1, 2, 3]);
  });
});
