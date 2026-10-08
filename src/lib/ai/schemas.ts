import { z } from "zod";
import { flatTaxonomy } from "@/lib/taxonomy";

// Enums are built from taxonomy.json, so the model can only ever name real entries. The pipeline
// still re-validates (discipline and subtopic must belong together) because an enum alone cannot
// express that pairing.
const unique = (xs: string[]) => [...new Set(xs)];
const DISCIPLINES = unique(flatTaxonomy().map((t) => t.discipline)) as [string, ...string[]];
const SUBTOPICS = unique(flatTaxonomy().map((t) => t.subtopic)) as [string, ...string[]];

export const tagResultSchema = z.object({
  section: z.enum(["PRECLINICAL", "CLINICAL"]),
  discipline: z.enum(DISCIPLINES),
  subtopic: z.enum(SUBTOPICS),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).nullable(),
  /** 0 to 1. Range is checked in code because the API schema cannot carry numeric bounds. */
  confidence: z.number(),
});
export type TagResult = z.infer<typeof tagResultSchema>;

export const FLAG_CODES = ["ANSWER_KEY_SUSPECT", "MULTIPLE_DEFENSIBLE", "WEAK_EXPLANATION", "UNSAFE_OR_OUTDATED_DRUG_INFO"] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

/** Pass 1 of the quality check: the model answers the question without ever seeing the key. */
export const blindAnswerSchema = z.object({ answer: z.enum(["A", "B", "C", "D"]) });
export type BlindAnswer = z.infer<typeof blindAnswerSchema>;

/** Pass 2: the review itself, given the key and the blind answer as evidence. */
export const qualityResultSchema = z.object({
  flags: z.array(z.object({ code: z.enum(FLAG_CODES), note: z.string() })),
  /** Only filled when the explanation is missing or weak; otherwise an empty string. */
  draftedExplanation: z.string(),
});
export type QualityResult = z.infer<typeof qualityResultSchema>;
