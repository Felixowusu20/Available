import { describe, expect, it } from "vitest";
import { COMMENT_MAX, NEEDS_ANSWER_REVEALED, REASON_LABEL, REPORT_REASONS, reportSchema } from "./report-reasons";

describe("reportSchema", () => {
  it("accepts a reason on its own and defaults the comment to empty", () => {
    expect(reportSchema.parse({ reason: "TYPO" })).toEqual({ reason: "TYPO", comment: "" });
  });

  it("trims the comment", () => {
    expect(reportSchema.parse({ reason: "UNCLEAR", comment: "  two options fit  " }).comment).toBe("two options fit");
  });

  it("rejects an unknown reason and a missing one", () => {
    expect(reportSchema.safeParse({ reason: "SPAM" }).success).toBe(false);
    expect(reportSchema.safeParse({ comment: "hello there" }).success).toBe(false);
  });

  it("needs a few words when the reason is Something else", () => {
    expect(reportSchema.safeParse({ reason: "OTHER" }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: "OTHER", comment: "   no   " }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: "OTHER", comment: "The image is missing" }).success).toBe(true);
  });

  it("caps the comment length", () => {
    expect(reportSchema.safeParse({ reason: "TYPO", comment: "x".repeat(COMMENT_MAX) }).success).toBe(true);
    expect(reportSchema.safeParse({ reason: "TYPO", comment: "x".repeat(COMMENT_MAX + 1) }).success).toBe(false);
  });
});

describe("reasons", () => {
  it("every reason has a label", () => {
    for (const r of REPORT_REASONS) expect(REASON_LABEL[r].length).toBeGreaterThan(0);
  });

  it("only answer-dependent reasons wait for the answer to be shown", () => {
    expect([...NEEDS_ANSWER_REVEALED].sort()).toEqual(["EXPLANATION", "WRONG_ANSWER"]);
  });
});
