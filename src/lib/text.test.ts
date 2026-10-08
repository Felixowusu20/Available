import { describe, expect, it } from "vitest";
import { contentHash, normaliseStem, shuffle, shuffleOptions } from "./text";

describe("normaliseStem", () => {
  it("ignores case, punctuation, accents and spacing", () => {
    expect(normaliseStem("  A 45-year-old  MAN, with Café-au-lait spots?  ")).toBe("a 45 year old man with cafe au lait spots");
  });
  it("gives the same hash for cosmetically different stems", () => {
    expect(contentHash("Which nerve?")).toBe(contentHash("  which   NERVE "));
    expect(contentHash("Which nerve?")).not.toBe(contentHash("Which artery?"));
  });
});

describe("shuffle", () => {
  it("keeps all items", () => {
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("does not mutate the input", () => {
    const a = [1, 2, 3];
    shuffle(a);
    expect(a).toEqual([1, 2, 3]);
  });
});

describe("shuffleOptions", () => {
  it("tracks where the correct option lands for every permutation the rng can produce", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 200; n++) {
      const { options, correctIndex } = shuffleOptions(["RIGHT", "a", "b", "c"], rng);
      expect(options).toHaveLength(4);
      expect(options[correctIndex]).toBe("RIGHT");
      expect(new Set(options).size).toBe(4);
    }
  });
});
