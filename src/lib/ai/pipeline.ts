import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@/generated/prisma/client";
import { getAiClient, type AiClient } from "@/lib/ai/client";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { addUsage, AiTaskError, noUsage, qualityCheck, tagQuestion, type Usage } from "@/lib/ai/tasks";
import { db } from "@/lib/db";
import { findSimilarTo } from "@/lib/duplicates";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ServiceError } from "@/lib/practice/http";

export type RunKind = "TAG" | "QUALITY";

/** Questions per request. Larger selections are sent in several requests, so no HTTP call runs for minutes. */
export const MAX_IDS_PER_RUN = 25;
const CONCURRENCY = 4;

export type RunSummary = {
  runId: string;
  kind: RunKind;
  model: string;
  requested: number;
  succeeded: number;
  failed: number;
  errors: string[];
  tokens: Usage;
  estimatedCostUsd: number | null;
};

/** A message that is safe to show an admin: no keys, no raw upstream bodies. */
function describe(err: unknown): string {
  if (err instanceof AiTaskError) return err.message;
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the AI provider (retries exhausted). Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI provider.";
  if (err instanceof Anthropic.APIError) return `AI provider error (${err.status ?? "network"}).`;
  return "Unexpected error while calling the AI provider.";
}

async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Runs tagging or quality checking over the given questions and stores the results as PENDING
 * suggestions for an admin to review. Nothing here changes a question or publishes anything.
 */
export async function runAi(args: { kind: RunKind; ids: string[]; adminId: string; client?: AiClient }): Promise<RunSummary> {
  const client = args.client ?? getAiClient(); // throws AiUnavailableError when there is no key
  const ids = [...new Set(args.ids)];
  if (ids.length === 0) throw new ServiceError(400, "Select at least one question.");
  if (ids.length > MAX_IDS_PER_RUN) throw new ServiceError(400, `At most ${MAX_IDS_PER_RUN} questions per run.`);

  const model = args.kind === "TAG" ? env().AI_TAGGING_MODEL : env().AI_QUALITY_MODEL;
  const questions = await db.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, stem: true, options: true, correctIndex: true, explanation: true },
  });
  if (questions.length === 0) throw new ServiceError(404, "None of those questions exist.");

  const run = await db.aiRun.create({
    data: { kind: args.kind === "TAG" ? "TAG" : "QUALITY", model, requestedById: args.adminId, questionCount: questions.length },
    select: { id: true },
  });

  let tokens = noUsage();
  let succeeded = 0;
  const errors: string[] = [];
  let fatal: string | null = null;

  await forEachLimited(questions, CONCURRENCY, async (q) => {
    if (fatal) return;
    try {
      let data: Omit<Prisma.AiSuggestionUncheckedCreateInput, "runId" | "questionId">;
      let used: Usage;
      if (args.kind === "TAG") {
        const { result, usage } = await tagQuestion(client, model, q);
        used = usage;
        data = {
          suggestedSection: result.section,
          suggestedDiscipline: result.discipline,
          suggestedSubtopic: result.subtopic,
          suggestedDifficulty: result.difficulty,
          confidence: result.confidence,
        };
      } else {
        const { result, usage } = await qualityCheck(client, model, env().AI_QUALITY_EFFORT, q);
        used = usage;
        data = { flags: result.flags, draftedExplanation: result.draftedExplanation || null };
      }
      tokens = addUsage(tokens, used);

      const similar = await findSimilarTo(q.id);
      // A fresh result supersedes any earlier unreviewed result of the same kind for this question.
      await db.aiSuggestion.deleteMany({
        where: { questionId: q.id, status: "PENDING", suggestedSection: args.kind === "TAG" ? { not: null } : null },
      });
      await db.aiSuggestion.create({ data: { ...data, runId: run.id, questionId: q.id, duplicates: similar.length ? similar : undefined } });
      succeeded++;
    } catch (err) {
      if (err instanceof AiTaskError) tokens = addUsage(tokens, err.usage); // tokens were spent even though the result was unusable
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        fatal = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
        return;
      }
      errors.push(describe(err));
    }
  });

  const failed = questions.length - succeeded;
  await db.aiRun.update({
    where: { id: run.id },
    data: {
      succeeded,
      failed,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      finishedAt: new Date(),
      error: fatal ?? (errors[0] ?? null),
    },
  });

  logger.info(
    { runId: run.id, kind: args.kind, model, requested: questions.length, succeeded, failed, inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.cacheRead },
    "ai run finished",
  );
  if (fatal) throw new ServiceError(502, fatal);

  return {
    runId: run.id,
    kind: args.kind,
    model,
    requested: questions.length,
    succeeded,
    failed,
    errors: [...new Set(errors)].slice(0, 5),
    tokens,
    estimatedCostUsd: estimateCostUsd(model, tokens),
  };
}
