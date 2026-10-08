import { createHash } from "node:crypto";

/** Lower-case, strip punctuation/diacritics, collapse whitespace. Used for duplicate detection. */
export function normaliseStem(stem: string): string {
  return stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(stem: string): string {
  return createHash("sha256").update(normaliseStem(stem)).digest("hex");
}

/** Fisher–Yates. Pass a custom rng for deterministic tests. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle 4 options (correct answer first in input) and return the new array plus where it landed.
 */
export function shuffleOptions(
  correctFirst: [string, string, string, string],
  rng: () => number = Math.random,
): { options: string[]; correctIndex: number } {
  const tagged = correctFirst.map((text, i) => ({ text, correct: i === 0 }));
  const shuffled = shuffle(tagged, rng);
  return {
    options: shuffled.map((o) => o.text),
    correctIndex: shuffled.findIndex((o) => o.correct),
  };
}
