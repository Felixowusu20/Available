import { describe, expect, it } from "vitest";
import { rollUp, topicKey } from "./topic-counts";

describe("rollUp", () => {
  it("counts what is left per subtopic and adds the subtopics up per discipline", () => {
    const out = rollUp([
      { discipline: "Anatomy", subtopic: "Thorax", total: 30, seen: 4 },
      { discipline: "Anatomy", subtopic: "Upper limb", total: 20, seen: 20 },
      { discipline: "Physiology", subtopic: "Respiratory", total: 10, seen: 0 },
    ]);
    expect(out.subtopics[topicKey("Anatomy", "Thorax")]).toEqual({ total: 30, left: 26 });
    expect(out.subtopics[topicKey("Anatomy", "Upper limb")]).toEqual({ total: 20, left: 0 });
    expect(out.disciplines.Anatomy).toEqual({ total: 50, left: 26 });
    expect(out.disciplines.Physiology).toEqual({ total: 10, left: 10 });
  });

  it("accepts the bigint counts the database returns, and never goes below zero", () => {
    const out = rollUp([{ discipline: "Anatomy", subtopic: "Thorax", total: BigInt(5), seen: BigInt(7) }]);
    expect(out.subtopics[topicKey("Anatomy", "Thorax")]).toEqual({ total: 5, left: 0 });
  });

  it("is empty when there are no published questions", () => {
    expect(rollUp([])).toEqual({ disciplines: {}, subtopics: {} });
  });
});
