import { beforeEach, describe, expect, it } from "vitest";
import { getAiClient, AiUnavailableError } from "@/lib/ai/client";
import { MAX_IDS_PER_RUN, runAi } from "@/lib/ai/pipeline";
import { resolveSuggestion } from "@/lib/ai/suggestions";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/practice/http";
import { fakeAi, fakeAiWith, makeAdmin, makeQuestion, resetDb } from "./helpers";

const tag = { section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Upper limb", difficulty: "EASY", confidence: 0.9 };

beforeEach(resetDb);

describe("AI tagging run", () => {
  it("stores PENDING suggestions, logs tokens, and changes nothing on the question itself", async () => {
    const admin = await makeAdmin();
    const a = await makeQuestion();
    const b = await makeQuestion();
    const { client } = fakeAi([
      { parsed: tag, usage: { input: 1000, output: 30, cache: 800 } },
      { parsed: tag, usage: { input: 1000, output: 30, cache: 800 } },
    ]);

    const summary = await runAi({ kind: "TAG", ids: [a.id, b.id], adminId: admin.id, client });

    expect(summary).toMatchObject({ kind: "TAG", requested: 2, succeeded: 2, failed: 0, model: "claude-haiku-5-5" });
    expect(summary.tokens).toEqual({ input: 2000, output: 60, cacheRead: 1600 });
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);

    const run = await db.aiRun.findUniqueOrThrow({ where: { id: summary.runId } });
    expect(run).toMatchObject({ kind: "TAG", succeeded: 2, failed: 0, inputTokens: 2000, outputTokens: 60, cacheReadTokens: 1600, requestedById: admin.id });
    expect(run.finishedAt).not.toBeNull();

    const suggestions = await db.aiSuggestion.findMany({ where: { runId: run.id } });
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.status === "PENDING" && s.suggestedDiscipline === "Anatomy" && s.confidence === 0.9)).toBe(true);

    // The point of the review step: the question is untouched until an admin accepts.
    const after = await db.question.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ section: null, discipline: null, subtopic: null, status: "DRAFT", aiMeta: null });
  });

  it("a newer result replaces the unreviewed older one instead of piling up", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion();
    await runAi({ kind: "TAG", ids: [q.id], adminId: admin.id, client: fakeAi([{ parsed: tag }]).client });
    await runAi({ kind: "TAG", ids: [q.id], adminId: admin.id, client: fakeAi([{ parsed: { ...tag, subtopic: "Lower limb" } }]).client });
    const pending = await db.aiSuggestion.findMany({ where: { questionId: q.id, status: "PENDING" } });
    expect(pending).toHaveLength(1);
    expect(pending[0].suggestedSubtopic).toBe("Lower limb");
  });

  it("records an unusable result as a failure, keeps the tokens it cost, and creates no suggestion", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion();
    const bad = { ...tag, discipline: "Anatomy", subtopic: "Cardiology" }; // pair not in the taxonomy
    const { client, calls } = fakeAi([{ parsed: bad }, { parsed: bad }, { parsed: bad }]);

    const summary = await runAi({ kind: "TAG", ids: [q.id], adminId: admin.id, client });

    expect(calls).toHaveLength(3); // retried, then gave up
    expect(summary).toMatchObject({ succeeded: 0, failed: 1 });
    expect(summary.errors[0]).toMatch(/valid taxonomy tag/);
    expect(summary.tokens.input).toBe(300);
    expect(await db.aiSuggestion.count()).toBe(0);
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: summary.runId } });
    expect(run).toMatchObject({ failed: 1, inputTokens: 300 });
    expect(run.error).toMatch(/valid taxonomy tag/);
  });

  it("keeps going when one question fails and another succeeds", async () => {
    const admin = await makeAdmin();
    const good = await makeQuestion({ stem: "GOOD question about the deltoid and its nerve supply" });
    const broken = await makeQuestion({ stem: "BROKEN question that the provider rejects every time" });
    const { client } = fakeAiWith((p) => {
      const user = (p.messages as { content: string }[])[0].content;
      return user.includes("BROKEN") ? new Error("provider exploded") : { parsed: tag };
    });
    const summary = await runAi({ kind: "TAG", ids: [good.id, broken.id], adminId: admin.id, client });
    expect(summary).toMatchObject({ succeeded: 1, failed: 1 });
    expect(summary.errors).toEqual(["Unexpected error while calling the AI provider."]);
    expect(await db.aiSuggestion.count({ where: { questionId: good.id } })).toBe(1);
    expect(await db.aiSuggestion.count({ where: { questionId: broken.id } })).toBe(0);
  });

  it("flags a near-duplicate of an existing question", async () => {
    const admin = await makeAdmin();
    const original = await makeQuestion({ stem: "A 24-year-old footballer falls on an outstretched hand and has tenderness in the anatomical snuffbox. Which bone is at risk of avascular necrosis?" });
    const copy = await makeQuestion({ stem: "A 24 year old footballer falls on an outstretched hand and has tenderness in the anatomical snuffbox. Which bone is at risk of avascular necrosis" });
    await runAi({ kind: "TAG", ids: [copy.id], adminId: admin.id, client: fakeAi([{ parsed: tag }]).client });
    const s = await db.aiSuggestion.findFirstOrThrow({ where: { questionId: copy.id } });
    const dups = s.duplicates as { questionId: string; similarity: number }[];
    expect(dups[0].questionId).toBe(original.id);
    expect(dups[0].similarity).toBeGreaterThan(0.8);
  });
});

describe("AI quality run", () => {
  const respond = (key: "A" | "B") => (p: Record<string, unknown>) => {
    const system = ((p.system as { text: string }[])[0]).text;
    return system.includes("answering a single-best-answer question")
      ? { parsed: { answer: key }, usage: { input: 200, output: 10 } }
      : { parsed: { flags: [{ code: "WEAK_EXPLANATION" as const, note: "No explanation." }], draftedExplanation: "The axillary nerve supplies the deltoid." }, usage: { input: 400, output: 120 } };
  };

  it("stores flags and a drafted explanation, and disagreement with the key adds a flag", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion({ correctIndex: 0 });
    const summary = await runAi({ kind: "QUALITY", ids: [q.id], adminId: admin.id, client: fakeAiWith(respond("B")).client });
    expect(summary).toMatchObject({ kind: "QUALITY", model: "claude-sonnet-5-5", succeeded: 1 });
    expect(summary.tokens).toEqual({ input: 600, output: 130, cacheRead: 0 });
    const s = await db.aiSuggestion.findFirstOrThrow({ where: { questionId: q.id } });
    expect((s.flags as { code: string }[]).map((f) => f.code).sort()).toEqual(["ANSWER_KEY_SUSPECT", "WEAK_EXPLANATION"]);
    expect(s.draftedExplanation).toBe("The axillary nerve supplies the deltoid.");
    expect(s.suggestedSection).toBeNull();
  });

  it("a quality result does not supersede a pending tagging result", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion();
    await runAi({ kind: "TAG", ids: [q.id], adminId: admin.id, client: fakeAi([{ parsed: tag }]).client });
    await runAi({ kind: "QUALITY", ids: [q.id], adminId: admin.id, client: fakeAiWith(respond("A")).client });
    expect(await db.aiSuggestion.count({ where: { questionId: q.id, status: "PENDING" } })).toBe(2);
  });
});

describe("run limits and availability", () => {
  it("rejects empty, oversized and unknown selections", async () => {
    const admin = await makeAdmin();
    const { client } = fakeAi([]);
    await expect(runAi({ kind: "TAG", ids: [], adminId: admin.id, client })).rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: MAX_IDS_PER_RUN + 1 }, (_, i) => `id${i}`);
    await expect(runAi({ kind: "TAG", ids: many, adminId: admin.id, client })).rejects.toMatchObject({ status: 400 });
    await expect(runAi({ kind: "TAG", ids: ["does-not-exist"], adminId: admin.id, client })).rejects.toBeInstanceOf(ServiceError);
    expect(await db.aiRun.count()).toBe(0);
  });

  it("without an API key the AI is unavailable, and nothing is written", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion();
    expect(() => getAiClient()).toThrow(AiUnavailableError);
    await expect(runAi({ kind: "TAG", ids: [q.id], adminId: admin.id })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await db.aiRun.count()).toBe(0);
  });
});

describe("admin review of a suggestion", () => {
  async function pendingTag() {
    const admin = await makeAdmin();
    const q = await makeQuestion({ explanation: "Original explanation." });
    await runAi({ kind: "TAG", ids: [q.id], adminId: admin.id, client: fakeAi([{ parsed: tag }]).client });
    const s = await db.aiSuggestion.findFirstOrThrow({ where: { questionId: q.id } });
    return { admin, q, s };
  }

  it("accept applies the tags and records AI metadata, but never changes the status", async () => {
    const { admin, q, s } = await pendingTag();
    await resolveSuggestion(admin.id, s.id, { action: "accept", applyTags: true, applyExplanation: false });
    const after = await db.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(after).toMatchObject({ section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Upper limb", difficulty: "EASY", status: "DRAFT", explanation: "Original explanation." });
    expect(after.publishedAt).toBeNull();
    expect(after.aiMeta).toMatchObject({ model: "claude-haiku-5-5", confidence: 0.9, tags: { discipline: "Anatomy" } });
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACCEPTED");
  });

  it("a suggestion can only be reviewed once", async () => {
    const { admin, s } = await pendingTag();
    await resolveSuggestion(admin.id, s.id, { action: "reject" });
    await expect(resolveSuggestion(admin.id, s.id, { action: "accept", applyTags: true, applyExplanation: false })).rejects.toMatchObject({ status: 409 });
  });

  it("reject leaves the question exactly as it was", async () => {
    const { admin, q, s } = await pendingTag();
    await resolveSuggestion(admin.id, s.id, { action: "reject" });
    const after = await db.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(after).toMatchObject({ section: null, discipline: null, aiMeta: null });
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("REJECTED");
  });

  it("edit applies the admin's own values and refuses tags outside the taxonomy", async () => {
    const { admin, q, s } = await pendingTag();
    await expect(
      resolveSuggestion(admin.id, s.id, { action: "edit", section: "CLINICAL", discipline: "Anatomy", subtopic: "Thorax" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(resolveSuggestion(admin.id, s.id, { action: "edit", section: "PRECLINICAL", discipline: "Anatomy" })).rejects.toMatchObject({ status: 400 });
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING"); // failed edits change nothing

    await resolveSuggestion(admin.id, s.id, { action: "edit", section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Thorax", explanation: "My own words." });
    const after = await db.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(after).toMatchObject({ subtopic: "Thorax", explanation: "My own words." });
    expect((await db.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("EDITED");
  });

  it("a drafted explanation replaces the existing one only when the admin asks", async () => {
    const admin = await makeAdmin();
    const q = await makeQuestion({ explanation: "Thin." });
    const client = fakeAiWith((p) => {
      const system = ((p.system as { text: string }[])[0]).text;
      return system.includes("answering a single-best-answer question") ? { parsed: { answer: "A" } } : { parsed: { flags: [], draftedExplanation: "A fuller explanation." } };
    }).client;
    await runAi({ kind: "QUALITY", ids: [q.id], adminId: admin.id, client });
    const s = await db.aiSuggestion.findFirstOrThrow({ where: { questionId: q.id } });

    await resolveSuggestion(admin.id, s.id, { action: "accept", applyTags: true, applyExplanation: false });
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).explanation).toBe("Thin.");

    await db.aiSuggestion.update({ where: { id: s.id }, data: { status: "PENDING" } }); // reopen to test the other branch
    await resolveSuggestion(admin.id, s.id, { action: "accept", applyTags: true, applyExplanation: true });
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).explanation).toBe("A fuller explanation.");
  });
});
