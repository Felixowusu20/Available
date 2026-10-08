import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { AiClient } from "@/lib/ai/client";
import {
  blindSystemPrompt,
  blindUserPrompt,
  keyLetter,
  qualitySystemPrompt,
  qualityUserPrompt,
  taggingSystemPrompt,
  taggingUserPrompt,
} from "@/lib/ai/prompts";
import { blindAnswerSchema, qualityResultSchema, tagResultSchema, type FlagCode, type TagResult } from "@/lib/ai/schemas";
import { isValidTags } from "@/lib/taxonomy";

export type Usage = { input: number; output: number; cacheRead: number };
export const noUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead };
}

type Effort = "low" | "medium" | "high";
export type QuestionForAi = { stem: string; options: string[]; correctIndex: number; explanation: string };

/** Thrown when the model's output cannot be used. Carries the tokens already spent so the run's cost stays honest. */
export class AiTaskError extends Error {
  constructor(
    message: string,
    public readonly usage: Usage,
  ) {
    super(message);
  }
}

/** One structured-output call. Returns the parsed value (or null if unusable) plus token usage. */
async function callStructured<S extends z.ZodType>(
  client: AiClient,
  p: { model: string; system: string; user: string; schema: S; maxTokens: number; effort: Effort },
): Promise<{ value: z.infer<S> | null; usage: Usage; stopReason: string | null }> {
  const res = await client.messages.parse({
    model: p.model,
    max_tokens: p.maxTokens,
    // The system prompt (taxonomy + rules) is identical for every question, so it is cached across a run.
    system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.user }],
    output_config: { format: zodOutputFormat(p.schema), effort: p.effort },
  });
  const usage: Usage = {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
  };
  return { value: (res.parsed_output as z.infer<S> | null) ?? null, usage, stopReason: res.stop_reason };
}

const MAX_TAG_ATTEMPTS = 3;

/** Why a tagging result is unusable, or null when it is fine. */
export function tagProblem(r: TagResult): string | null {
  if (!isValidTags(r.section, r.discipline, r.subtopic)) {
    return `"${r.discipline} / ${r.subtopic}" is not a valid ${r.section} entry: the subtopic must belong to the discipline, and the discipline decides the section`;
  }
  if (!(r.confidence >= 0 && r.confidence <= 1)) return "confidence must be between 0 and 1";
  return null;
}

/**
 * Tags one question. Anything outside the taxonomy is rejected and the model is asked again, up to
 * MAX_TAG_ATTEMPTS times, with the reason; after that the question fails instead of guessing.
 */
export async function tagQuestion(client: AiClient, model: string, q: QuestionForAi): Promise<{ result: TagResult; usage: Usage }> {
  let usage = noUsage();
  let correction = "";
  for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt++) {
    const { value, usage: u, stopReason } = await callStructured(client, {
      model,
      system: taggingSystemPrompt(),
      user: taggingUserPrompt(q) + correction,
      schema: tagResultSchema,
      maxTokens: 4000,
      effort: "low",
    });
    usage = addUsage(usage, u);
    if (stopReason === "refusal") throw new AiTaskError("The model declined to classify this question.", usage);
    if (!value) {
      correction = "\n\nYour previous reply could not be used (it was cut off or malformed). Reply again with the required fields only.";
      continue;
    }
    const problem = tagProblem(value);
    if (!problem) return { result: { ...value, confidence: Math.round(value.confidence * 100) / 100 }, usage };
    correction = `\n\nYour previous answer was rejected: ${problem}. Choose a valid combination from the taxonomy.`;
  }
  throw new AiTaskError(`The model did not return a valid taxonomy tag after ${MAX_TAG_ATTEMPTS} attempts.`, usage);
}

export type QualityOutcome = {
  flags: { code: FlagCode; note: string }[];
  draftedExplanation: string;
  blindAnswer: string;
};

/**
 * Two passes. (1) The model answers WITHOUT the key. (2) A review call sees the key and that blind
 * answer. If the blind answer disagrees with the key, ANSWER_KEY_SUSPECT is added in code, so the
 * most important check does not depend on the model remembering to raise it.
 */
export async function qualityCheck(
  client: AiClient,
  model: string,
  effort: Effort,
  q: QuestionForAi,
): Promise<{ result: QualityOutcome; usage: Usage }> {
  let usage = noUsage();

  const blind = await callStructured(client, { model, system: blindSystemPrompt(), user: blindUserPrompt(q), schema: blindAnswerSchema, maxTokens: 8000, effort });
  usage = addUsage(usage, blind.usage);
  if (blind.stopReason === "refusal" || !blind.value) throw new AiTaskError("The model did not return a usable blind answer.", usage);
  const blindAnswer = blind.value.answer;

  const review = await callStructured(client, {
    model,
    system: qualitySystemPrompt(),
    user: qualityUserPrompt(q, blindAnswer),
    schema: qualityResultSchema,
    maxTokens: 8000,
    effort,
  });
  usage = addUsage(usage, review.usage);
  if (review.stopReason === "refusal" || !review.value) throw new AiTaskError("The model did not return a usable review.", usage);

  const flags = review.value.flags.map((f) => ({ code: f.code, note: f.note.trim() }));
  const key = keyLetter(q.correctIndex);
  if (blindAnswer !== key && !flags.some((f) => f.code === "ANSWER_KEY_SUSPECT")) {
    flags.push({ code: "ANSWER_KEY_SUSPECT", note: `A blind reviewer chose ${blindAnswer} but the key is ${key}.` });
  }
  return { result: { flags, draftedExplanation: review.value.draftedExplanation.trim(), blindAnswer }, usage };
}
