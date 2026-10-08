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

describe("composeList", () => {
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
