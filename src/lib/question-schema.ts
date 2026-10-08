import { z } from "zod";
import { isValidTags } from "@/lib/taxonomy";

export const SECTION_VALUES = ["PRECLINICAL", "CLINICAL"] as const;
export const STATUS_VALUES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "RETIRED"] as const;
export const DIFFICULTY_VALUES = ["EASY", "MEDIUM", "HARD"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

/** Fields every question has, however it arrived (admin form, import, seed). */
export const questionBaseShape = {
  stem: text(4000),
  options: z.array(text(1000)).length(4, "Exactly 4 options are required"),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().max(8000).default(""),
  section: z.enum(SECTION_VALUES).nullish(),
  discipline: text(100).nullish(),
  subtopic: text(100).nullish(),
  difficulty: z.enum(DIFFICULTY_VALUES).nullish(),
  source: z.string().trim().max(300).nullish(),
  status: z.enum(STATUS_VALUES).default("DRAFT"),
  legacyTopic: z.string().trim().max(200).nullish(),
};

type Checkable = {
  options: string[];
  section?: string | null;
  discipline?: string | null;
  subtopic?: string | null;
  status: string;
};

/** Cross-field rules shared by the full schema and the admin edit schema. */
export function refineQuestion(q: Checkable, ctx: z.RefinementCtx) {
  const hasAny = !!(q.section || q.discipline || q.subtopic);
  const hasAll = !!(q.section && q.discipline && q.subtopic);
  if (hasAny && !hasAll) {
    ctx.addIssue({ code: "custom", path: ["subtopic"], message: "Set section, discipline and subtopic together, or leave all three empty" });
  } else if (hasAll && !isValidTags(q.section!, q.discipline!, q.subtopic!)) {
    ctx.addIssue({
      code: "custom",
      path: ["subtopic"],
      message: `"${q.discipline} / ${q.subtopic}" is not a ${q.section} entry in the taxonomy`,
    });
  }
  if (!hasAll && (q.status === "IN_REVIEW" || q.status === "PUBLISHED")) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Tag the question (section, discipline, subtopic) before moving it past Draft" });
  }
  if (new Set(q.options.map((o) => o.toLowerCase())).size !== 4) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Options must all be different" });
  }
}

/** Validated shape of a question as stored. */
export const questionInputSchema = z.object(questionBaseShape).superRefine(refineQuestion);

export type QuestionInput = z.infer<typeof questionInputSchema>;
