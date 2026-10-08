import { describe, expect, it } from "vitest";
import type { AiClient } from "./client";
import { estimateCostUsd } from "./pricing";
import { tagResultSchema } from "./schemas";
import { AiTaskError, qualityCheck, tagProblem, tagQuestion } from "./tasks";

type Reply = { parsed: unknown; stop?: string; usage?: { input: number; output: number; cache?: number } };

// A stand-in for the Anthropic SDK: replays canned replies and records every request.
function fake(replies: Reply[]) {
  const calls: Record<string, unknown>[] = [];
  const queue = [...replies];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        const r = queue.shift();
        if (!r) throw new Error("fake client ran out of replies");
        return {
          parsed_output: r.parsed,
          stop_reason: r.stop ?? "end_turn",
          usage: { input_tokens: r.usage?.input ?? 100, output_tokens: r.usage?.output ?? 20, cache_read_input_tokens: r.usage?.cache ?? 0 },
        };
      },
    },
  } as unknown as AiClient;
  return { client, calls };
}

const q = { stem: "Which nerve supplies the deltoid?", options: ["Axillary", "Radial", "Ulnar", "Median"], correctIndex: 0, explanation: "" };
const good = { section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Upper limb", difficulty: "EASY", confidence: 0.93 };

describe("tagQuestion", () => {
  it("returns a valid tag and the token usage", async () => {
    const { client } = fake([{ parsed: good, usage: { input: 1200, output: 40, cache: 1000 } }]);
    const { result, usage } = await tagQuestion(client, "claude-haiku-5-5", q);
    expect(result).toMatchObject({ section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Upper limb" });
    expect(usage).toEqual({ input: 1200, output: 40, cacheRead: 1000 });
  });

  it("sends the request shape the API requires", async () => {
    const { client, calls } = fake([{ parsed: good }]);
    await tagQuestion(client, "claude-haiku-5-5", q);
    const p = calls[0] as { model: string; output_config: { effort: string; format: unknown }; system: { cache_control: unknown; text: string }[]; temperature?: unknown; thinking?: unknown; tool_choice?: unknown };
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p.output_config.effort).toBe("low");
    expect(p.output_config.format).toBeTruthy();
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral" });
    // These are rejected (HTTP 400) by the current models, so they must never be sent.
    expect(p.temperature).toBeUndefined();
    expect(p.thinking).toBeUndefined();
    expect(p.tool_choice).toBeUndefined();
  });

  it("puts the tagging rule and the full taxonomy in the system prompt", async () => {
    const { client, calls } = fake([{ parsed: good }]);
    await tagQuestion(client, "m", q);
    const system = (calls[0].system as { text: string }[])[0].text;
    expect(system).toMatch(/KNOWLEDGE the question tests, not by how it is framed/);
    expect(system).toMatch(/which nerve is injured tests Anatomy, so it is PRECLINICAL/);
    expect(system).toContain("Upper limb");
    expect(system).toContain("Ethics and forensic medicine");
  });

  it("rejects a discipline/subtopic pair that does not belong together, then retries with the reason", async () => {
    const wrong = { ...good, discipline: "Anatomy", subtopic: "Cardiology" }; // both exist, but not together
    const { client, calls } = fake([{ parsed: wrong, usage: { input: 100, output: 10 } }, { parsed: good, usage: { input: 150, output: 12 } }]);
    const { result, usage } = await tagQuestion(client, "m", q);
    expect(result.subtopic).toBe("Upper limb");
    expect(usage).toEqual({ input: 250, output: 22, cacheRead: 0 }); // both attempts are counted
    const retryPrompt = (calls[1].messages as { content: string }[])[0].content;
    expect(retryPrompt).toMatch(/previous answer was rejected/);
    expect(retryPrompt).toContain("Anatomy / Cardiology");
  });

  it("retries when the output was cut off (null), and gives up after 3 attempts without guessing", async () => {
    const { client, calls } = fake([{ parsed: null }, { parsed: { ...good, section: "CLINICAL" } }, { parsed: { ...good, confidence: 7 } }]);
    const err = await tagQuestion(client, "m", q).catch((e) => e);
    expect(err).toBeInstanceOf(AiTaskError);
    expect((err as AiTaskError).usage.input).toBe(300);
    expect(calls).toHaveLength(3);
  });

  it("fails cleanly when the model declines", async () => {
    const { client } = fake([{ parsed: null, stop: "refusal" }]);
    await expect(tagQuestion(client, "m", q)).rejects.toThrow(/declined/);
  });
});

describe("tagProblem", () => {
  it("accepts good tags and flags every kind of mismatch", () => {
    expect(tagProblem(good as never)).toBeNull();
    expect(tagProblem({ ...good, section: "CLINICAL" } as never)).toMatch(/not a valid CLINICAL entry/);
    expect(tagProblem({ ...good, confidence: 1.2 } as never)).toMatch(/between 0 and 1/);
    expect(tagProblem({ ...good, confidence: -0.1 } as never)).toMatch(/between 0 and 1/);
  });
});

describe("tag schema", () => {
  it("only allows names from the taxonomy", () => {
    expect(tagResultSchema.safeParse(good).success).toBe(true);
    expect(tagResultSchema.safeParse({ ...good, discipline: "Astrology" }).success).toBe(false);
    expect(tagResultSchema.safeParse({ ...good, subtopic: "Made up" }).success).toBe(false);
  });
});

describe("qualityCheck", () => {
  const review = (flags: { code: string; note: string }[] = [], draft = "") => ({ parsed: { flags, draftedExplanation: draft } });

  it("answers blind first, and never shows the key in that call", async () => {
    const { client, calls } = fake([{ parsed: { answer: "A" } }, review()]);
    await qualityCheck(client, "claude-sonnet-5-5", "medium", { ...q, explanation: "Because." });
    const blindPrompt = (calls[0].messages as { content: string }[])[0].content;
    const reviewPrompt = (calls[1].messages as { content: string }[])[0].content;
    expect(blindPrompt).not.toMatch(/answer_key/);
    expect(blindPrompt).not.toMatch(/Because\./);
    expect(reviewPrompt).toMatch(/<answer_key>A<\/answer_key>/);
    expect(reviewPrompt).toMatch(/<blind_answer>A<\/blind_answer>/);
  });

  it("uses the configured effort and model on both calls", async () => {
    const { client, calls } = fake([{ parsed: { answer: "A" } }, review()]);
    await qualityCheck(client, "claude-sonnet-5-5", "medium", q);
    for (const c of calls) {
      expect((c.output_config as { effort: string }).effort).toBe("medium");
      expect(c.model).toBe("claude-sonnet-5-5");
    }
  });

  it("adds ANSWER_KEY_SUSPECT in code when the blind answer disagrees with the key", async () => {
    const { client } = fake([{ parsed: { answer: "C" } }, review()]);
    const { result } = await qualityCheck(client, "m", "medium", q);
    expect(result.flags).toEqual([{ code: "ANSWER_KEY_SUSPECT", note: expect.stringContaining("chose C but the key is A") }]);
  });

  it("does not duplicate the flag when the model already raised it", async () => {
    const { client } = fake([{ parsed: { answer: "B" } }, review([{ code: "ANSWER_KEY_SUSPECT", note: " Radial is correct. " }])]);
    const { result } = await qualityCheck(client, "m", "medium", q);
    expect(result.flags).toEqual([{ code: "ANSWER_KEY_SUSPECT", note: "Radial is correct." }]);
  });

  it("passes through other flags and a trimmed drafted explanation, and sums both calls' tokens", async () => {
    const { client } = fake([
      { parsed: { answer: "A" }, usage: { input: 300, output: 50 } },
      { parsed: { flags: [{ code: "WEAK_EXPLANATION", note: "Missing." }, { code: "UNSAFE_OR_OUTDATED_DRUG_INFO", note: "Dose." }], draftedExplanation: "  The axillary nerve supplies deltoid.  " }, usage: { input: 500, output: 150 } },
    ]);
    const { result, usage } = await qualityCheck(client, "m", "high", q);
    expect(result.flags.map((f) => f.code)).toEqual(["WEAK_EXPLANATION", "UNSAFE_OR_OUTDATED_DRUG_INFO"]);
    expect(result.draftedExplanation).toBe("The axillary nerve supplies deltoid.");
    expect(usage).toEqual({ input: 800, output: 200, cacheRead: 0 });
  });

  it("fails cleanly on an unusable reply and keeps the tokens spent", async () => {
    const { client } = fake([{ parsed: { answer: "A" }, usage: { input: 10, output: 1 } }, { parsed: null, usage: { input: 20, output: 2 } }]);
    const err = await qualityCheck(client, "m", "medium", q).catch((e) => e);
    expect(err).toBeInstanceOf(AiTaskError);
    expect((err as AiTaskError).usage).toEqual({ input: 30, output: 3, cacheRead: 0 });
  });
});

describe("estimateCostUsd", () => {
  it("prices tokens and discounts cache reads", () => {
    // Sonnet 5.5: $2 in / $10 out per million; cache reads at 10% of input price
    expect(estimateCostUsd("claude-sonnet-5-5", { input: 1_000_000, output: 100_000, cacheRead: 0 })).toBeCloseTo(3, 6);
    expect(estimateCostUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.2, 6);
    expect(estimateCostUsd("claude-haiku-5-5", { input: 1_000_000, output: 1_000_000, cacheRead: 0 })).toBeCloseTo(0.6, 6);
  });
  it("returns null for models it has no price for", () => {
    expect(estimateCostUsd("some-other-model", { input: 1, output: 1, cacheRead: 0 })).toBeNull();
  });
});
