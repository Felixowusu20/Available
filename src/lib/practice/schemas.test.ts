import { describe, expect, it } from "vitest";
import { createSessionSchema } from "./schemas";

const topic = (extra: Record<string, unknown>) => createSessionSchema.safeParse({ kind: "TOPIC", count: 50, mode: "LEARN", ...extra });

describe("topic sessions: choosing a whole section", () => {
  it("accepts one section on its own, either one", () => {
    expect(topic({ sections: ["PRECLINICAL"] }).success).toBe(true);
    expect(topic({ sections: ["CLINICAL"] }).success).toBe(true);
  });
  it("still accepts the old way: disciplines or subtopics, with no sections at all", () => {
    expect(topic({ disciplines: ["Anatomy"] }).success).toBe(true);
    expect(topic({ subtopics: [{ discipline: "Anatomy", subtopic: "Thorax" }] }).success).toBe(true);
  });
  it("refuses a choice of nothing, an unknown section, and a silly number of questions", () => {
    expect(topic({}).success).toBe(false);
    expect(topic({ sections: [] }).success).toBe(false);
    expect(topic({ sections: ["SURGICAL"] }).success).toBe(false);
    expect(topic({ sections: ["CLINICAL"], count: 4 }).success).toBe(false);
    expect(topic({ sections: ["CLINICAL"], count: 201 }).success).toBe(false);
  });
});
