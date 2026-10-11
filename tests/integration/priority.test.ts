import { beforeEach, describe, expect, it } from "vitest";
import { parseImport } from "@/lib/admin/import";
import { commitRows } from "@/lib/admin/import-service";
import { bulkSchema, bulkSetPriority, listQuestions, listFiltersSchema, statusCounts, updateQuestion } from "@/lib/admin/questions";
import { db } from "@/lib/db";
import { createSession, saveAnswer } from "@/lib/practice/service";
import { correctSlot, makeAdmin, makeStudent, resetDb, seedBank } from "./helpers";

beforeEach(resetDb);

/** Marks the first `n` published questions of a section (by stem order) as high priority and returns their ids. */
async function prioritise(section: "PRECLINICAL" | "CLINICAL", n: number, extra: { discipline?: string } = {}) {
  const rows = await db.question.findMany({ where: { status: "PUBLISHED", section, ...(extra.discipline && { discipline: extra.discipline }) }, orderBy: { stem: "asc" }, take: n, select: { id: true } });
  const ids = rows.map((r) => r.id);
  await db.question.updateMany({ where: { id: { in: ids } }, data: { highPriority: true } });
  return ids;
}

const sessionQuestionIds = async (sessionId: string) => (await db.sessionQuestion.findMany({ where: { sessionId }, select: { questionId: true } })).map((r) => r.questionId);

describe("high priority in practice sessions", () => {
  it("a mock draws every unseen high-priority published question, and never a non-published one", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const pre = await prioritise("PRECLINICAL", 12);
    const cli = await prioritise("CLINICAL", 12);
    // Priority on questions students must not see changes nothing.
    await db.question.updateMany({ where: { status: { not: "PUBLISHED" } }, data: { highPriority: true } });

    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    const chosen = new Set(await sessionQuestionIds(id));
    expect([...pre, ...cli].every((q) => chosen.has(q))).toBe(true);
    const rows = await db.sessionQuestion.findMany({ where: { sessionId: id }, include: { question: { select: { status: true } } } });
    expect(rows.every((r) => r.question.status === "PUBLISHED")).toBe(true);
  });

  it("still builds a correct 25/25 mock when many questions are high priority", async () => {
    await seedBank({ pre: 60, cli: 60 });
    await prioritise("PRECLINICAL", 60);
    await prioritise("CLINICAL", 60);
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 100, mode: "EXAM" });
    for (const block of [0, 1]) {
      const rows = await db.sessionQuestion.findMany({ where: { sessionId: id, blockIndex: block }, include: { question: { select: { section: true } } } });
      expect(rows).toHaveLength(50);
      expect(rows.filter((r) => r.question.section === "PRECLINICAL")).toHaveLength(25);
      expect(rows.filter((r) => r.question.section === "CLINICAL")).toHaveLength(25);
    }
  });

  it("a topic session includes the high-priority questions of that topic first, and not those of another topic", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const anatomy = await prioritise("PRECLINICAL", 6, { discipline: "Anatomy" });
    const physiology = await prioritise("PRECLINICAL", 6, { discipline: "Physiology" });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    const chosen = new Set(await sessionQuestionIds(id));
    expect(anatomy.every((q) => chosen.has(q))).toBe(true);
    expect(physiology.some((q) => chosen.has(q))).toBe(false);
  });

  it("once a student has seen the priority questions, fresh ordinary ones come before repeats", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const anatomy = await prioritise("PRECLINICAL", 6, { discipline: "Anatomy" });
    const u = await makeStudent();

    const first = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    const firstRows = await db.sessionQuestion.findMany({ where: { sessionId: first }, orderBy: { position: "asc" } });
    for (const r of firstRows) await saveAnswer(u.id, first, r.position, { selected: await correctSlot(first, r.position), guessed: false, timeSpentMs: 500 });

    const second = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    const secondIds = new Set(await sessionQuestionIds(second));
    expect(anatomy.some((q) => secondIds.has(q))).toBe(false); // 30 anatomy questions, only 10 seen: all repeats avoided
  });

  it("does not change what students receive: no priority field reaches the question payload", async () => {
    await seedBank({ pre: 30, cli: 30 });
    await prioritise("PRECLINICAL", 5);
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "LEARN" });
    const { getQuestions } = await import("@/lib/practice/service");
    const payload = await getQuestions(u.id, id, 0, 5);
    expect(JSON.stringify(payload)).not.toMatch(/priority/i);
  });
});

describe("setting priority as an admin", () => {
  it("bulk set and clear change only questions that differ, on any status", async () => {
    await seedBank({ pre: 5, cli: 5 });
    const all = await db.question.findMany({ select: { id: true, status: true } });
    const ids = all.map((q) => q.id);

    expect(await bulkSetPriority(ids, true)).toEqual({ updated: ids.length });
    expect(await db.question.count({ where: { highPriority: true } })).toBe(ids.length);
    expect(await bulkSetPriority(ids, true)).toEqual({ updated: 0 });
    expect(await bulkSetPriority(ids.slice(0, 4), false)).toEqual({ updated: 4 });
    expect(await db.question.count({ where: { highPriority: true } })).toBe(ids.length - 4);
  });

  it("the bulk request accepts either a status or a priority change, never an empty one", () => {
    expect(bulkSchema.safeParse({ ids: ["a"], status: "PUBLISHED" }).success).toBe(true);
    expect(bulkSchema.safeParse({ ids: ["a"], highPriority: true }).success).toBe(true);
    expect(bulkSchema.safeParse({ ids: ["a"] }).success).toBe(false);
    expect(bulkSchema.safeParse({ ids: [], highPriority: true }).success).toBe(false);
  });

  it("the list filter and the dashboard count see priority, and the dashboard counts published ones only", async () => {
    await seedBank({ pre: 5, cli: 5 });
    await prioritise("PRECLINICAL", 3);
    const draft = await db.question.findFirstOrThrow({ where: { status: "DRAFT" } });
    await db.question.update({ where: { id: draft.id }, data: { highPriority: true } });

    const filters = listFiltersSchema.parse({ priority: "1" });
    expect((await listQuestions(filters)).total).toBe(4);
    expect((await listQuestions(listFiltersSchema.parse({ priority: "1", status: "PUBLISHED" }))).total).toBe(3);
    expect((await statusCounts()).highPriority).toBe(3);
  });

  it("editing a question saves the flag, and leaving it out of an edit clears it", async () => {
    const admin = await makeAdmin();
    await seedBank({ pre: 2, cli: 2, extraNonPublished: false });
    const q = await db.question.findFirstOrThrow({ where: { status: "PUBLISHED" } });
    const input = { stem: q.stem, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation, section: q.section, discipline: q.discipline, subtopic: q.subtopic, difficulty: null, source: null, status: q.status, highPriority: true } as const;
    await updateQuestion(admin.id, q.id, input);
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).highPriority).toBe(true);
    await updateQuestion(admin.id, q.id, { ...input, highPriority: false });
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).highPriority).toBe(false);
  });

  it("an import can mark rows high priority, and they arrive as drafts", async () => {
    const admin = await makeAdmin();
    const row = (n: number, extra: Record<string, unknown> = {}) => ({
      stem: `Priority import ${n}: which structure carries the deoxygenated blood in scenario number ${n}?`,
      options: ["First", "Second", "Third", "Fourth"],
      correct: "A",
      explanation: "Because.",
      ...extra,
    });
    const rows = parseImport(JSON.stringify([row(1, { priority: "high" }), row(2)]), "json").rows;
    await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: null });
    const saved = await db.question.findMany({ orderBy: { stem: "asc" } });
    expect(saved.map((q) => [q.highPriority, q.status])).toEqual([[true, "DRAFT"], [false, "DRAFT"]]);
  });
});
