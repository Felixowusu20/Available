import { describe, expect, it } from "vitest";
import { disciplinesOf, flatTaxonomy, isValidTags, sectionOfDiscipline, subtopicsOf } from "./taxonomy";

describe("taxonomy", () => {
  it("accepts valid combinations and rejects mismatches", () => {
    expect(isValidTags("PRECLINICAL", "Anatomy", "Thorax")).toBe(true);
    expect(isValidTags("CLINICAL", "Anatomy", "Thorax")).toBe(false); // wrong section
    expect(isValidTags("PRECLINICAL", "Anatomy", "Made up")).toBe(false);
    expect(isValidTags("OTHER", "Anatomy", "Thorax")).toBe(false);
  });

  it("knows the section of a discipline", () => {
    expect(sectionOfDiscipline("Pharmacology")).toBe("PRECLINICAL");
    expect(sectionOfDiscipline("Surgery")).toBe("CLINICAL");
    expect(sectionOfDiscipline("Nonsense")).toBeUndefined();
  });

  it("has no discipline in both sections and no empty subtopic lists", () => {
    const pre = new Set(disciplinesOf("PRECLINICAL"));
    for (const d of disciplinesOf("CLINICAL")) expect(pre.has(d)).toBe(false);
    for (const { discipline } of flatTaxonomy()) expect(subtopicsOf(discipline).length).toBeGreaterThan(0);
  });

  it("matches the agreed size", () => {
    expect(disciplinesOf("PRECLINICAL")).toHaveLength(9);
    expect(disciplinesOf("CLINICAL")).toHaveLength(12);
  });
});
