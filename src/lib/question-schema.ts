import { z } from "zod";
import { isValidTags } from "@/lib/taxonomy";

export const SECTION_VALUES = ["PRECLINICAL", "CLINICAL"] as const;
export const STATUS_VALUES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "RETIRED"] as const;
export const DIFFICULTY_VALUES = ["EASY", "MEDIUM", "HARD"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

/** Validated shape of a question as stored (used by admin forms, import and seeding). */
export const questionInputSchema = z
  .object({
    stem: text(4000),
    options: z.array(text(1000)).length(4, "Exactly 4 options are required"),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().max(8000).default(""),
    section: z.enum(SECTION_VALUES),
    discipline: text(100),
    subtopic: text(100),
    difficulty: z.enum(DIFFICULTY_VALUES).nullish(),
    source: z.string().trim().max(300).nullish(),
    status: z.enum(STATUS_VALUES).default("DRAFT"),
    legacyTopic: z.string().trim().max(200).nullish(),
  })
  .superRefine((q, ctx) => {
    if (!isValidTags(q.section, q.discipline, q.subtopic)) {
      ctx.addIssue({
        code: "custom",
        path: ["subtopic"],
        message: `"${q.discipline} / ${q.subtopic}" is not a ${q.section} entry in the taxonomy`,
      });
    }
    if (new Set(q.options.map((o) => o.toLowerCase())).size !== 4) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Options must all be different" });
    }
  });

export type QuestionInput = z.infer<typeof questionInputSchema>;
