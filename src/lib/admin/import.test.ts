import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, normaliseRow, parseImport } from "./import";

const good = {
  stem: "Which nerve supplies the deltoid?",
  options: ["Axillary", "Radial", "Ulnar", "Median"],
  correct: "A",
  explanation: "The axillary nerve.",
};

describe("normaliseRow", () => {
  it("accepts a minimal untagged question and forces DRAFT", () => {
    const r = normaliseRow({ ...good, status: "PUBLISHED" }, 1);
    expect(r.errors).toEqual([]);
    expect(r.input?.status).toBe("DRAFT");
    expect(r.input?.correctIndex).toBe(0);
    expect(r.input?.section ?? null).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Untagged/);
  });

  it("reads correct answers as letter, 1-based number, 0-based index or option text", () => {
    expect(normaliseRow({ ...good, correct: "c" }, 1).input?.correctIndex).toBe(2);
    expect(normaliseRow({ ...good, correct: 4 }, 1).input?.correctIndex).toBe(3);
    expect(normaliseRow({ stem: good.stem, options: good.options, correctIndex: 1 }, 1).input?.correctIndex).toBe(1);
    expect(normaliseRow({ ...good, correct: "radial" }, 1).input?.correctIndex).toBe(1);
  });

  it("accepts option columns in several spellings and names tolerant keys", () => {
    const r = normaliseRow({ Question: good.stem, "Option A": "w", "Option B": "x", "Option C": "y", "Option D": "z", Answer: "B" }, 3);
    expect(r.errors).toEqual([]);
    expect(r.input?.options).toEqual(["w", "x", "y", "z"]);
    expect(r.input?.correctIndex).toBe(1);
  });

  it("canonicalises taxonomy tags and infers the section from the discipline", () => {
    const r = normaliseRow({ ...good, discipline: "anatomy", subtopic: "UPPER LIMB" }, 1);
    expect(r.input).toMatchObject({ section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Upper limb" });
  });

  it("drops invalid tags with a warning instead of failing the row", () => {
    const r = normaliseRow({ ...good, discipline: "Astrology", subtopic: "Stars" }, 1);
    expect(r.errors).toEqual([]);
    expect(r.input?.discipline ?? null).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/not in the taxonomy/);
    const half = normaliseRow({ ...good, discipline: "Anatomy", subtopic: "Nonsense" }, 1);
    expect(half.input?.subtopic ?? null).toBeNull();
  });

  it("reports clear errors", () => {
    expect(normaliseRow({ options: good.options, correct: "A" }, 1).errors.join()).toMatch(/Missing question text/);
    expect(normaliseRow({ stem: "x", options: ["a", "b", "c"], correct: "A" }, 1).errors.join()).toMatch(/exactly 4/);
    expect(normaliseRow({ ...good, correct: "Z" }, 1).errors.join()).toMatch(/Could not tell/);
    expect(normaliseRow({ ...good, options: ["a", "a", "b", "c"] }, 1).errors.join()).toMatch(/different/);
    expect(normaliseRow({ stem: "x", options: good.options }, 1).errors.join()).toMatch(/Missing correct/);
  });
});

describe("parseImport", () => {
  it("parses a JSON array and a { questions } wrapper", () => {
    expect(parseImport(JSON.stringify([good, good]), "json").rows).toHaveLength(2);
    expect(parseImport(JSON.stringify({ questions: [good] }), "json").rows).toHaveLength(1);
  });

  it("parses CSV with quoted commas and pipe-separated options", () => {
    const csv = 'stem,options,correct,explanation\n"Which, exactly?",Axillary|Radial|Ulnar|Median,A,"Because, reasons"\n';
    const { rows } = parseImport(csv, "csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].input?.stem).toBe("Which, exactly?");
    expect(rows[0].input?.explanation).toBe("Because, reasons");
  });

  it("returns fatal messages for unusable input", () => {
    expect(parseImport("", "json").fatal).toMatch(/empty/);
    expect(parseImport("{not json", "json").fatal).toMatch(/Invalid JSON/);
    expect(parseImport('{"a":1}', "json").fatal).toMatch(/array/);
    expect(parseImport(JSON.stringify(Array(MAX_IMPORT_ROWS + 1).fill(good)), "json").fatal).toMatch(/Too many rows/);
  });

  it("keeps good rows when other rows are bad", () => {
    const { rows } = parseImport(JSON.stringify([good, { stem: "no options" }, 5]), "json");
    expect(rows.map((r) => r.errors.length > 0)).toEqual([false, true, true]);
    expect(rows.map((r) => r.row)).toEqual([1, 2, 3]);
  });
});
