import { z } from "zod";
import { isValidTags, sectionOfDiscipline } from "@/lib/taxonomy";

const mode = z.enum(["LEARN", "EXAM"]);

const topicPair = z
  .object({ discipline: z.string().max(100), subtopic: z.string().max(100) })
  .refine((t) => {
    const section = sectionOfDiscipline(t.discipline);
    return !!section && isValidTags(section, t.discipline, t.subtopic);
  }, "Unknown subtopic");

export const createSessionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MOCK"), size: z.union([z.literal(50), z.literal(100), z.literal(200)]), mode }),
  z
    .object({
      kind: z.literal("TOPIC"),
      disciplines: z
        .array(z.string().max(100).refine((d) => !!sectionOfDiscipline(d), "Unknown discipline"))
        .max(30)
        .default([]),
      subtopics: z.array(topicPair).max(100).default([]),
      count: z.number().int().min(5).max(200),
      mode,
    })
    .refine((t) => t.disciplines.length + t.subtopics.length > 0, "Choose at least one discipline or subtopic"),
  z.object({ kind: z.literal("REDO_MISSED"), count: z.number().int().min(5).max(200).default(50), mode }),
  z.object({ kind: z.literal("BOOKMARKS"), mode }),
]);
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const answerSchema = z.object({
  /** Display slot 0-3 the student picked, or null to clear the answer (exam mode only). */
  selected: z.number().int().min(0).max(3).nullable(),
  guessed: z.boolean().default(false),
  /** Time spent on this question so far, in ms. */
  timeSpentMs: z.number().int().min(0).max(6 * 60 * 60 * 1000).default(0),
});

export const flagSchema = z.object({ flagged: z.boolean() });
export const bookmarkSchema = z.object({ bookmarked: z.boolean() });

export const windowSchema = z.object({
  from: z.coerce.number().int().min(0).default(0),
  count: z.coerce.number().int().min(1).max(25).default(10),
});
