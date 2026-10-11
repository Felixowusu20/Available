import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAvailability } from "@/lib/practice/availability";
import { topicKey } from "@/lib/practice/topic-counts";
import { createSession, saveAnswer } from "@/lib/practice/service";
import { correctSlot, makeStudent, resetDb, seedBank } from "./helpers";

beforeEach(resetDb);

// seedBank makes 60 preclinical and 60 clinical published questions: 30 Anatomy (Thorax), 30 Physiology (Respiratory),
// 30 Surgery (Trauma) and 30 Paediatrics (Neonatology), plus draft, in-review and retired copies that must never count.
const answerAll = async (userId: string, sessionId: string, upTo: number) => {
  for (let p = 0; p < upTo; p++) await saveAnswer(userId, sessionId, p, { selected: await correctSlot(sessionId, p), guessed: false, timeSpentMs: 500 });
};

describe("questions left per topic", () => {
  it("starts with every published question left, and ignores drafts, in-review and retired ones", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const a = await getAvailability(u.id);
    expect(a.disciplines.Anatomy).toEqual({ total: 30, left: 30 });
    expect(a.disciplines.Surgery).toEqual({ total: 30, left: 30 });
    expect(a.subtopics[topicKey("Anatomy", "Thorax")]).toEqual({ total: 30, left: 30 });
  });

  it("goes down as the student answers questions, and the other topics are untouched", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    await answerAll(u.id, id, 4);
    let a = await getAvailability(u.id);
    expect(a.disciplines.Anatomy).toEqual({ total: 30, left: 26 });
    expect(a.subtopics[topicKey("Anatomy", "Thorax")].left).toBe(26);
    expect(a.disciplines.Physiology.left).toBe(30);

    await answerAll(u.id, id, 10);
    a = await getAvailability(u.id);
    expect(a.disciplines.Anatomy.left).toBe(20);
  });

  it("counts answers given in a mock too, even before the mock is finished", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await answerAll(u.id, id, 10);
    const a = await getAvailability(u.id);
    const leftTotal = Object.values(a.disciplines).reduce((n, d) => n + d.left, 0);
    expect(leftTotal).toBe(120 - 10);
  });

  it("does not count an answer that was cleared again, or a question only flagged", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await saveAnswer(u.id, id, 0, { selected: 0, guessed: false, timeSpentMs: 100 });
    await saveAnswer(u.id, id, 0, { selected: null, guessed: false, timeSpentMs: 100 });
    const { setFlag } = await import("@/lib/practice/service");
    await setFlag(u.id, id, 1, true);
    const a = await getAvailability(u.id);
    expect(Object.values(a.disciplines).reduce((n, d) => n + d.left, 0)).toBe(120);
  });

  it("is per student", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u1 = await makeStudent("one@test.local");
    const u2 = await makeStudent("two@test.local");
    const id = await createSession(u1.id, { kind: "TOPIC", disciplines: ["Surgery"], subtopics: [], count: 10, mode: "LEARN" });
    await answerAll(u1.id, id, 10);
    expect((await getAvailability(u1.id)).disciplines.Surgery.left).toBe(20);
    expect((await getAvailability(u2.id)).disciplines.Surgery.left).toBe(30);
  });

  it("stops counting a question once it is retired, whether or not it was answered", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    await answerAll(u.id, id, 3);
    const answered = await db.answer.findFirstOrThrow({ where: { userId: u.id, selectedIndex: { not: null } } });
    await db.question.update({ where: { id: answered.questionId }, data: { status: "RETIRED" } });
    const unanswered = await db.question.findFirstOrThrow({ where: { discipline: "Anatomy", status: "PUBLISHED", sessionQuestions: { none: {} } } });
    await db.question.update({ where: { id: unanswered.id }, data: { status: "RETIRED" } });
    // 30 published - 2 retired = 28 in total; 3 answered - 1 retired = 2 still counted as answered.
    expect((await getAvailability(u.id)).disciplines.Anatomy).toEqual({ total: 28, left: 26 });
  });
});
