import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NotEnoughQuestionsError } from "@/lib/practice/compose";
import {
  createSession,
  finishSession,
  getQuestions,
  getResults,
  getState,
  saveAnswer,
  setBookmark,
  setFlag,
  switchToLearn,
} from "@/lib/practice/service";
import { correctSlot, makeStudent, resetDb, seedBank } from "./helpers";

beforeEach(resetDb);

const answer = (selected: number | null, extra: { guessed?: boolean; timeSpentMs?: number } = {}) => ({ selected, guessed: extra.guessed ?? false, timeSpentMs: extra.timeSpentMs ?? 1000 });

async function sectionCounts(sessionId: string, block?: number) {
  const rows = await db.sessionQuestion.findMany({ where: { sessionId, ...(block === undefined ? {} : { blockIndex: block }) }, include: { question: { select: { section: true, status: true } } } });
  return {
    total: rows.length,
    pre: rows.filter((r) => r.question.section === "PRECLINICAL").length,
    cli: rows.filter((r) => r.question.section === "CLINICAL").length,
    nonPublished: rows.filter((r) => r.question.status !== "PUBLISHED").length,
  };
}

describe("mock sessions", () => {
  it.each([50, 100] as const)("a %i-question mock is half preclinical, half clinical, and 25/25 in every block of 50", async (size) => {
    await seedBank({ pre: 110, cli: 110 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size, mode: "EXAM" });
    expect(await sectionCounts(id)).toMatchObject({ total: size, pre: size / 2, cli: size / 2, nonPublished: 0 });
    for (let b = 0; b < size / 50; b++) expect(await sectionCounts(id, b)).toMatchObject({ total: 50, pre: 25, cli: 25 });
    const positions = (await db.sessionQuestion.findMany({ where: { sessionId: id }, orderBy: { position: "asc" } })).map((r) => r.position);
    expect(positions).toEqual(Array.from({ length: size }, (_, i) => i));
  });

  it("never serves draft, in-review or retired questions", async () => {
    await seedBank({ pre: 25, cli: 25 }); // exactly enough published, plus 30 non-published
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "LEARN" });
    expect((await sectionCounts(id)).nonPublished).toBe(0);
  });

  it("refuses when the bank is too small rather than shortening the mock", async () => {
    await seedBank({ pre: 30, cli: 30 });
    const u = await makeStudent();
    await expect(createSession(u.id, { kind: "MOCK", size: 200, mode: "EXAM" })).rejects.toBeInstanceOf(NotEnoughQuestionsError);
    expect(await db.practiceSession.count()).toBe(0);
  });

  it("prefers questions the student has not seen yet", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const first = await createSession(u.id, { kind: "MOCK", size: 50, mode: "LEARN" });
    for (let p = 0; p < 50; p++) await saveAnswer(u.id, first, p, answer(await correctSlot(first, p)));
    const seen = new Set((await db.sessionQuestion.findMany({ where: { sessionId: first } })).map((r) => r.questionId));
    const second = await createSession(u.id, { kind: "MOCK", size: 50, mode: "LEARN" });
    const overlap = (await db.sessionQuestion.findMany({ where: { sessionId: second } })).filter((r) => seen.has(r.questionId)).length;
    expect(overlap).toBe(0); // 60+60 published, 25+25 already seen, plenty unseen
  });
});

describe("exam mode", () => {
  it("gives no feedback until the session is finished, and allows changing and clearing answers", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    const right = await correctSlot(id, 0);
    const wrong = (right + 1) % 4;

    let r = await saveAnswer(u.id, id, 0, answer(right));
    expect(r.feedback).toBeUndefined();
    let q = (await getQuestions(u.id, id, 0, 1))[0];
    expect(q).toMatchObject({ selected: right });
    expect(q.feedback).toBeUndefined();
    expect(JSON.stringify(await getState(u.id, id))).not.toMatch(/correct"|"wrong"/); // map shows no results yet

    r = await saveAnswer(u.id, id, 0, answer(wrong)); // change
    expect((await getQuestions(u.id, id, 0, 1))[0].selected).toBe(wrong);
    r = await saveAnswer(u.id, id, 0, answer(null)); // clear
    expect((await getQuestions(u.id, id, 0, 1))[0].selected).toBeNull();

    await saveAnswer(u.id, id, 0, answer(right));
    await finishSession(u.id, id);
    q = (await getQuestions(u.id, id, 0, 1))[0];
    expect(q.feedback).toMatchObject({ correctSlot: right });
    await expect(saveAnswer(u.id, id, 0, answer(wrong))).rejects.toMatchObject({ status: 409 }); // finished sessions are read-only
  });

  it("scores correctly, counts unanswered as wrong, and reports guesses separately", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    // 10 answered correctly (3 of them marked as guesses), 5 wrong (2 guesses), 35 left blank
    for (let p = 0; p < 10; p++) await saveAnswer(u.id, id, p, answer(await correctSlot(id, p), { guessed: p < 3 }));
    for (let p = 10; p < 15; p++) await saveAnswer(u.id, id, p, answer(((await correctSlot(id, p)) + 1) % 4, { guessed: p < 12 }));
    await setFlag(u.id, id, 20, true);
    await finishSession(u.id, id);

    const res = (await getResults(u.id, id))!;
    expect(res.summary).toMatchObject({ total: 50, answered: 15, correct: 10, scorePct: 20 });
    expect(res.summary.guessed).toEqual({ count: 5, correct: 3 });
    expect(res.summary.confident).toEqual({ count: 10, correct: 7 });
    expect(res.summary.bySection.PRECLINICAL.total + res.summary.bySection.CLINICAL.total).toBe(50);
    expect(res.summary.byBlock).toHaveLength(1);
    expect(res.questions.find((q) => q.position === 20)?.flagged).toBe(true);
    const s = await db.practiceSession.findUniqueOrThrow({ where: { id } });
    expect(s).toMatchObject({ correctCount: 10, answeredCount: 15, guessedCount: 5, correctGuessed: 3 });
    // weakest topics come first
    const acc = res.summary.byDiscipline.map((d) => d.accuracy);
    expect(acc).toEqual([...acc].sort((a, b) => a - b));
  });

  it("finishing twice is harmless and does not change the score", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await saveAnswer(u.id, id, 0, answer(await correctSlot(id, 0)));
    await finishSession(u.id, id);
    const first = await db.practiceSession.findUniqueOrThrow({ where: { id } });
    await finishSession(u.id, id);
    const second = await db.practiceSession.findUniqueOrThrow({ where: { id } });
    expect(second.finishedAt).toEqual(first.finishedAt);
    expect(second.correctCount).toBe(1);
  });

  it("is finalised automatically once the time (plus grace) has run out, and later answers are refused", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await saveAnswer(u.id, id, 0, answer(await correctSlot(id, 0)));
    // pretend the exam started 2 hours ago; the limit is 50 questions x 72 s = 1 hour
    await db.practiceSession.update({ where: { id }, data: { startedAt: new Date(Date.now() - 2 * 3600 * 1000) } });

    const state = await getState(u.id, id);
    expect(state.finished).toBe(true);
    await expect(saveAnswer(u.id, id, 1, answer(0))).rejects.toMatchObject({ status: 409 });
    const s = await db.practiceSession.findUniqueOrThrow({ where: { id } });
    expect(s.correctCount).toBe(1);
    // finished at the deadline, not at the moment someone happened to look
    expect(s.finishedAt!.getTime()).toBeLessThanOrEqual(s.startedAt.getTime() + 3600 * 1000 + 1000);
  });
});

describe("learn mode", () => {
  it("shows feedback immediately and locks the answer", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
    const right = await correctSlot(id, 0);
    const wrong = (right + 1) % 4;

    const r = await saveAnswer(u.id, id, 0, answer(wrong));
    expect(r.feedback).toMatchObject({ correctSlot: right, discipline: "Anatomy" });
    expect(r.feedback!.explanation).toMatch(/^Explanation/);

    await expect(saveAnswer(u.id, id, 0, answer(right))).rejects.toMatchObject({ status: 409 }); // cannot change
    const again = await saveAnswer(u.id, id, 0, answer(wrong)); // a retried request is fine
    expect(again.feedback?.correctSlot).toBe(right);
    await expect(saveAnswer(u.id, id, 1, answer(null))).rejects.toMatchObject({ status: 400 }); // must choose

    const map = (await getState(u.id, id)).map;
    expect(map[0]).toMatchObject({ answered: true, result: "wrong" });
    expect(map[1]).toMatchObject({ answered: false, result: null });
  });

  it("topic practice only draws from the chosen discipline and subtopic", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: [], subtopics: [{ discipline: "Surgery", subtopic: "Trauma" }], count: 20, mode: "LEARN" });
    const rows = await db.sessionQuestion.findMany({ where: { sessionId: id }, include: { question: true } });
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.question.discipline === "Surgery" && r.question.subtopic === "Trauma" && r.question.status === "PUBLISHED")).toBe(true);
  });

  it("an empty selection gives a clear error, not an empty session", async () => {
    await seedBank();
    const u = await makeStudent();
    await expect(createSession(u.id, { kind: "TOPIC", disciplines: ["Genetics"], subtopics: [], count: 10, mode: "LEARN" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("switching from exam to learn", () => {
  it("keeps answers, stops the timer, reveals answered questions, and locks new answers", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    const right0 = await correctSlot(id, 0);
    await saveAnswer(u.id, id, 0, answer(right0, { guessed: true }));
    await saveAnswer(u.id, id, 1, answer(((await correctSlot(id, 1)) + 1) % 4));

    const before = await getState(u.id, id);
    expect(before.deadline).not.toBeNull();
    await switchToLearn(u.id, id);
    await switchToLearn(u.id, id); // second call is a no-op

    const after = await getState(u.id, id);
    expect(after).toMatchObject({ mode: "LEARN", deadline: null, switchedFromExam: true, finished: false });
    expect(after.map[0]).toMatchObject({ answered: true, result: "correct" });
    expect(after.map[1]).toMatchObject({ answered: true, result: "wrong" });
    expect(after.map[2]).toMatchObject({ answered: false, result: null });

    const qs = await getQuestions(u.id, id, 0, 3);
    expect(qs[0]).toMatchObject({ selected: right0, guessed: true });
    expect(qs[0].feedback?.correctSlot).toBe(right0);
    expect(qs[2].feedback).toBeUndefined(); // unanswered questions are still hidden

    const r = await saveAnswer(u.id, id, 2, answer(await correctSlot(id, 2)));
    expect(r.feedback).toBeDefined();
    await expect(saveAnswer(u.id, id, 0, answer(((right0 + 1) % 4)))).rejects.toMatchObject({ status: 409 });

    await finishSession(u.id, id);
    await expect(switchToLearn(u.id, id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("redo missed and bookmarks", () => {
  it("redo missed contains only questions whose latest answer was wrong", async () => {
    await seedBank({ pre: 30, cli: 30 });
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 6, mode: "LEARN" });
    const wrongIds: string[] = [];
    for (let p = 0; p < 6; p++) {
      const right = await correctSlot(id, p);
      const sq = await db.sessionQuestion.findUniqueOrThrow({ where: { sessionId_position: { sessionId: id, position: p } } });
      if (p < 4) {
        await saveAnswer(u.id, id, p, answer((right + 1) % 4));
        wrongIds.push(sq.questionId);
      } else await saveAnswer(u.id, id, p, answer(right));
    }
    await finishSession(u.id, id);

    // one of the four missed questions is later answered correctly in another session, so it drops out
    const second = await createSession(u.id, { kind: "REDO_MISSED", count: 10, mode: "LEARN" });
    const queued = await db.sessionQuestion.findMany({ where: { sessionId: second } });
    expect(queued.map((r) => r.questionId).sort()).toEqual([...wrongIds].sort());
    const target = queued[0];
    await saveAnswer(u.id, second, target.position, answer(await correctSlot(second, target.position)));
    await finishSession(u.id, second);

    const third = await createSession(u.id, { kind: "REDO_MISSED", count: 10, mode: "LEARN" });
    const again = (await db.sessionQuestion.findMany({ where: { sessionId: third } })).map((r) => r.questionId);
    expect(again).toHaveLength(3);
    expect(again).not.toContain(target.questionId);
  });

  it("redo missed with nothing missed explains itself", async () => {
    await seedBank();
    const u = await makeStudent();
    await expect(createSession(u.id, { kind: "REDO_MISSED", count: 10, mode: "LEARN" })).rejects.toMatchObject({ status: 422 });
  });

  it("bookmarks can be added and removed from a session and practised later", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await setBookmark(u.id, id, 3, true);
    await setBookmark(u.id, id, 7, true);
    await setBookmark(u.id, id, 7, false);
    expect((await getQuestions(u.id, id, 3, 1))[0].bookmarked).toBe(true);
    expect((await getQuestions(u.id, id, 7, 1))[0].bookmarked).toBe(false);

    await finishSession(u.id, id);
    await setBookmark(u.id, id, 9, true); // allowed even after finishing: bookmarks belong to the student
    const marked = await createSession(u.id, { kind: "BOOKMARKS", mode: "LEARN" });
    expect(await db.sessionQuestion.count({ where: { sessionId: marked } })).toBe(2);
  });

  it("a retired question disappears from bookmarks practice", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await createSession(u.id, { kind: "MOCK", size: 50, mode: "EXAM" });
    await setBookmark(u.id, id, 0, true);
    const sq = await db.sessionQuestion.findUniqueOrThrow({ where: { sessionId_position: { sessionId: id, position: 0 } } });
    await db.question.update({ where: { id: sq.questionId }, data: { status: "RETIRED" } });
    await expect(createSession(u.id, { kind: "BOOKMARKS", mode: "LEARN" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("students only see their own data", () => {
  it("another student's session is 'not found' for every operation", async () => {
    await seedBank();
    const owner = await makeStudent("owner@test.local");
    const other = await makeStudent("other@test.local");
    const id = await createSession(owner.id, { kind: "MOCK", size: 50, mode: "EXAM" });

    await expect(getState(other.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(getQuestions(other.id, id, 0, 5)).rejects.toMatchObject({ status: 404 });
    await expect(saveAnswer(other.id, id, 0, answer(0))).rejects.toMatchObject({ status: 404 });
    await expect(setFlag(other.id, id, 0, true)).rejects.toMatchObject({ status: 404 });
    await expect(setBookmark(other.id, id, 0, true)).rejects.toMatchObject({ status: 404 });
    await expect(switchToLearn(other.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(finishSession(other.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(getResults(other.id, id)).rejects.toMatchObject({ status: 404 });
    // and nothing was changed by those attempts
    expect(await db.answer.count()).toBe(0);
    expect((await db.practiceSession.findUniqueOrThrow({ where: { id } })).finishedAt).toBeNull();
  });

  it("one student's answers do not influence another student's 'seen' or 'missed' lists", async () => {
    await seedBank({ pre: 30, cli: 30 });
    const a = await makeStudent("a@test.local");
    const b = await makeStudent("b@test.local");
    const id = await createSession(a.id, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 5, mode: "LEARN" });
    for (let p = 0; p < 5; p++) await saveAnswer(a.id, id, p, answer(((await correctSlot(id, p)) + 1) % 4));
    await expect(createSession(b.id, { kind: "REDO_MISSED", count: 10, mode: "LEARN" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("practising one section", () => {
  const section = (userId: string, sections: ("PRECLINICAL" | "CLINICAL")[], count = 50, mode: "LEARN" | "EXAM" = "LEARN") =>
    createSession(userId, { kind: "TOPIC", disciplines: [], subtopics: [], sections, count, mode });

  it("gives exactly the number asked, all from the chosen section, whichever it is", async () => {
    await seedBank({ pre: 80, cli: 80 });
    const u = await makeStudent();
    const pre = await section(u.id, ["PRECLINICAL"]);
    expect(await sectionCounts(pre)).toMatchObject({ total: 50, pre: 50, cli: 0, nonPublished: 0 });
    const cli = await section(u.id, ["CLINICAL"], 30);
    expect(await sectionCounts(cli)).toMatchObject({ total: 30, pre: 0, cli: 30, nonPublished: 0 });
    expect((await db.practiceSession.findUniqueOrThrow({ where: { id: pre } })).filter).toMatchObject({ sections: ["PRECLINICAL"] });
  });

  it("prefers questions not yet answered, so a second 50 is a fresh 50", async () => {
    await seedBank({ pre: 120, cli: 20 });
    const u = await makeStudent();
    const first = await section(u.id, ["PRECLINICAL"]);
    for (let p = 0; p < 50; p++) await saveAnswer(u.id, first, p, answer(await correctSlot(first, p)));
    const seen = new Set((await db.sessionQuestion.findMany({ where: { sessionId: first } })).map((r) => r.questionId));
    const second = await section(u.id, ["PRECLINICAL"]);
    const overlap = (await db.sessionQuestion.findMany({ where: { sessionId: second } })).filter((r) => seen.has(r.questionId)).length;
    expect(overlap).toBe(0); // 120 published, 50 answered: plenty of fresh ones
  });

  it("gives what exists when the section has fewer questions than asked, and refuses when it has none", async () => {
    await seedBank({ pre: 12, cli: 0 });
    const u = await makeStudent();
    const id = await section(u.id, ["PRECLINICAL"], 50);
    expect((await sectionCounts(id)).total).toBe(12);
    await expect(section(u.id, ["CLINICAL"])).rejects.toMatchObject({ status: 422 });
  });

  it("works as a timed exam too, with time for the number of questions", async () => {
    await seedBank({ pre: 60, cli: 60 });
    const u = await makeStudent();
    const id = await section(u.id, ["PRECLINICAL"], 50, "EXAM");
    const s = await db.practiceSession.findUniqueOrThrow({ where: { id } });
    expect(s).toMatchObject({ mode: "EXAM", questionCount: 50, timeLimitSeconds: 50 * 72 });
  });
});
