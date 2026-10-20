import { z } from "zod";

// Pure and client-safe (no database import), so the report dialog and the admin screens can share it.

export const REPORT_REASONS = ["WRONG_ANSWER", "UNCLEAR", "TYPO", "OUTDATED", "EXPLANATION", "OTHER"] as const;
export type ReportReasonValue = (typeof REPORT_REASONS)[number];

export const REASON_LABEL: Record<ReportReasonValue, string> = {
  WRONG_ANSWER: "The correct answer looks wrong",
  UNCLEAR: "Unclear, or more than one answer could be right",
  TYPO: "Typo or wording error",
  OUTDATED: "Outdated or unsafe information",
  EXPLANATION: "The explanation is wrong or missing",
  OTHER: "Something else",
};

/** Reasons that only make sense once the student has seen the answer and explanation. */
export const NEEDS_ANSWER_REVEALED: ReadonlySet<ReportReasonValue> = new Set(["WRONG_ANSWER", "EXPLANATION"]);

export const COMMENT_MAX = 1000;
const OTHER_MIN = 5;

export const reportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    comment: z.string().trim().max(COMMENT_MAX, `Keep it under ${COMMENT_MAX} characters`).default(""),
  })
  .superRefine((r, ctx) => {
    if (r.reason === "OTHER" && r.comment.length < OTHER_MIN) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "Tell us briefly what is wrong" });
    }
  });
export type ReportInput = z.infer<typeof reportSchema>;
