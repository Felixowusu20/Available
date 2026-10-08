import { shuffle } from "@/lib/text";

export type PoolItem = { id: string; section: "PRECLINICAL" | "CLINICAL" };
export type Composed = { questionId: string; position: number; blockIndex: number };

export const BLOCK_SIZE = 50;
export const MOCK_SIZES = [50, 100, 200] as const;
export type MockSize = (typeof MOCK_SIZES)[number];

export class NotEnoughQuestionsError extends Error {
  constructor(
    public readonly need: number,
    public readonly have: number,
    public readonly what: string,
  ) {
    super(`Not enough ${what} questions available (need ${need}, have ${have}).`);
  }
}

/** Unseen questions first (shuffled), then previously seen ones (shuffled). */
function preferUnseen<T extends { id: string }>(items: T[], seen: Set<string>, rng: () => number): T[] {
  const fresh = items.filter((i) => !seen.has(i.id));
  const old = items.filter((i) => seen.has(i.id));
  return [...shuffle(fresh, rng), ...shuffle(old, rng)];
}

/**
 * Mock exam: always half preclinical and half clinical, and every block of 50 holds
 * 25 of each, mixed together. Unseen questions are preferred.
 */
export function composeMock(pool: PoolItem[], size: MockSize, seen: Set<string>, rng: () => number = Math.random): Composed[] {
  const half = size / 2;
  const perBlock = BLOCK_SIZE / 2;
  const pre = preferUnseen(pool.filter((p) => p.section === "PRECLINICAL"), seen, rng);
  const cli = preferUnseen(pool.filter((p) => p.section === "CLINICAL"), seen, rng);
  if (pre.length < half) throw new NotEnoughQuestionsError(half, pre.length, "preclinical");
  if (cli.length < half) throw new NotEnoughQuestionsError(half, cli.length, "clinical");

  const out: Composed[] = [];
  for (let b = 0; b < size / BLOCK_SIZE; b++) {
    const block = shuffle([...pre.slice(b * perBlock, (b + 1) * perBlock), ...cli.slice(b * perBlock, (b + 1) * perBlock)], rng);
    block.forEach((q, i) => out.push({ questionId: q.id, position: b * BLOCK_SIZE + i, blockIndex: b }));
  }
  return out;
}

/** Topic / redo / bookmark sessions: up to `count` questions, unseen first, in random order. */
export function composeList(pool: { id: string }[], count: number, seen: Set<string>, rng: () => number = Math.random): Composed[] {
  if (pool.length === 0) throw new NotEnoughQuestionsError(1, 0, "matching");
  const chosen = shuffle(preferUnseen(pool, seen, rng).slice(0, count), rng);
  return chosen.map((q, i) => ({ questionId: q.id, position: i, blockIndex: Math.floor(i / BLOCK_SIZE) }));
}

/** Permutation of 0..3 describing the display order of options for one session question. */
export function randomOptionOrder(rng: () => number = Math.random): number[] {
  return shuffle([0, 1, 2, 3], rng);
}
