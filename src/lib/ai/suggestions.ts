import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/practice/http";
import { DIFFICULTY_VALUES, SECTION_VALUES } from "@/lib/question-schema";
import { isValidTags } from "@/lib/taxonomy";

export const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("accept"),
    /** Apply the suggested section/discipline/subtopic (and difficulty). */
    applyTags: z.boolean().default(true),
    /** Replace the question's explanation with the AI draft. Off by default: a human decides. */
    applyExplanation: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("edit"),
    section: z.enum(SECTION_VALUES).nullish(),
    discipline: z.string().max(100).nullish(),
    subtopic: z.string().max(100).nullish(),
    difficulty: z.enum(DIFFICULTY_VALUES).nullish(),
    explanation: z.string().trim().max(8000).nullish(),
  }),
]);
export type ResolveInput = z.infer<typeof resolveSchema>;

/**
 * Applies an admin's decision to a pending suggestion. This is the ONLY place AI output reaches a
 * question, and it never changes the question's status: publishing stays a separate admin action.
 */
export async function resolveSuggestion(adminId: string, id: string, input: ResolveInput): Promise<void> {
  const s = await db.aiSuggestion.findUnique({ where: { id }, include: { question: true, run: { select: { model: true } } } });
  if (!s) throw new ServiceError(404, "Suggestion not found");
  if (s.status !== "PENDING") throw new ServiceError(409, "This suggestion has already been reviewed.");

  const resolved = { resolvedAt: new Date(), resolvedById: adminId };
  if (input.action === "reject") {
    await db.aiSuggestion.update({ where: { id }, data: { status: "REJECTED", ...resolved } });
    return;
  }

  const update: Prisma.QuestionUpdateInput = {};
  let tags: { section: string; discipline: string; subtopic: string } | null = null;
  let explanation: string | null = null;

  if (input.action === "accept") {
    if (input.applyTags && s.suggestedSection && s.suggestedDiscipline && s.suggestedSubtopic) {
      tags = { section: s.suggestedSection, discipline: s.suggestedDiscipline, subtopic: s.suggestedSubtopic };
      if (s.suggestedDifficulty && !s.question.difficulty) update.difficulty = s.suggestedDifficulty;
    }
    if (input.applyExplanation && s.draftedExplanation) explanation = s.draftedExplanation;
  } else {
    const anyTag = input.section || input.discipline || input.subtopic;
    if (anyTag) {
      if (!input.section || !input.discipline || !input.subtopic) throw new ServiceError(400, "Set section, discipline and subtopic together.");
      tags = { section: input.section, discipline: input.discipline, subtopic: input.subtopic };
      if (input.difficulty) update.difficulty = input.difficulty;
    }
    if (input.explanation) explanation = input.explanation;
  }

  if (tags) {
    if (!isValidTags(tags.section, tags.discipline, tags.subtopic)) {
      throw new ServiceError(400, `"${tags.discipline} / ${tags.subtopic}" is not a valid ${tags.section} entry in the taxonomy.`);
    }
    update.section = tags.section as "PRECLINICAL" | "CLINICAL";
    update.discipline = tags.discipline;
    update.subtopic = tags.subtopic;
  }
  if (explanation) update.explanation = explanation;

  const previous = (s.question.aiMeta ?? {}) as Record<string, unknown>;
  update.aiMeta = {
    ...previous,
    ...(tags && { tags, confidence: s.confidence }),
    ...(s.flags ? { flags: s.flags } : {}),
    model: s.run.model,
    runId: s.runId,
    reviewedAt: new Date().toISOString(),
  } as Prisma.InputJsonValue;

  await db.$transaction([
    db.question.update({ where: { id: s.questionId }, data: update }),
    db.aiSuggestion.update({ where: { id }, data: { status: input.action === "edit" ? "EDITED" : "ACCEPTED", ...resolved } }),
  ]);
}
