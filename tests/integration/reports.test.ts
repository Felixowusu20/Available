import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/practice/http";
import { createSession, finishSession, getQuestions, getResults } from "@/lib/practice/service";
import { closeReports, countReportedQuestions, listClosedReports, listOpenReportGroups, submitReport } from "@/lib/reports";
import { makeAdmin, makeStudent, resetDb, seedBank } from "./helpers";

beforeEach(resetDb);

const topicSession = (userId: string) => createSession(userId, { kind: "TOPIC", disciplines: ["Anatomy"], subtopics: [], count: 10, mode: "LEARN" });
/** A session over exactly these questions, so two students can be served the same one. */
const sessionWith = async (userId: string, questionIds: string[]) =>
  (
    await db.practiceSession.create({
      data: {
        userId,
        kind: "TOPIC",
        mode: "LEARN",
        questionCount: questionIds.length,
        questions: { create: questionIds.map((questionId, position) => ({ position, blockIndex: 0, questionId, optionOrder: [0, 1, 2, 3] })) },
      },
      select: { id: true },
    })
  ).id;
const publishedIds = async (n: number) => (await db.question.findMany({ where: { status: "PUBLISHED" }, take: n, orderBy: { id: "asc" }, select: { id: true } })).map((q) => q.id);
const questionAt = async (sessionId: string, position: number) => (await db.sessionQuestion.findUniqueOrThrow({ where: { sessionId_position: { sessionId, position } } })).questionId;

describe("reporting a question", () => {
  it("stores an open report for the question the student was shown", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await submitReport(u.id, id, 2, { reason: "TYPO", comment: "Ventricle is spelled wrongly" });
    const rows = await db.questionReport.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: u.id, questionId: await questionAt(id, 2), reason: "TYPO", comment: "Ventricle is spelled wrongly", status: "OPEN" });
  });

  it("replaces the student's own open report instead of adding another", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await submitReport(u.id, id, 0, { reason: "TYPO", comment: "" });
    await submitReport(u.id, id, 0, { reason: "WRONG_ANSWER", comment: "B is correct" });
    const rows = await db.questionReport.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "WRONG_ANSWER", comment: "B is correct", status: "OPEN" });
  });

  it("keeps one open report even when two requests arrive together", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await Promise.all([
      submitReport(u.id, id, 0, { reason: "TYPO", comment: "" }),
      submitReport(u.id, id, 0, { reason: "UNCLEAR", comment: "" }),
      submitReport(u.id, id, 0, { reason: "OUTDATED", comment: "" }),
    ]);
    expect(await db.questionReport.count({ where: { status: "OPEN" } })).toBe(1);
  });

  it("the database itself refuses a second open report from the same student on a question", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    const questionId = await questionAt(id, 0);
    await db.questionReport.create({ data: { userId: u.id, questionId, reason: "TYPO" } });
    await expect(db.questionReport.create({ data: { userId: u.id, questionId, reason: "UNCLEAR" } })).rejects.toThrow();
  });

  it("only works for a question in the student's own session", async () => {
    await seedBank();
    const owner = await makeStudent("owner@test.local");
    const other = await makeStudent("other@test.local");
    const id = await topicSession(owner.id);
    await expect(submitReport(other.id, id, 0, { reason: "TYPO", comment: "" })).rejects.toMatchObject({ status: 404 });
    await expect(submitReport(owner.id, id, 99, { reason: "TYPO", comment: "" })).rejects.toBeInstanceOf(ServiceError);
    await expect(submitReport(owner.id, "no-such-session", 0, { reason: "TYPO", comment: "" })).rejects.toMatchObject({ status: 404 });
    expect(await db.questionReport.count()).toBe(0);
  });

  it("still works after the session has finished, so results can be reported", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await finishSession(u.id, id);
    await submitReport(u.id, id, 1, { reason: "EXPLANATION", comment: "It does not explain why" });
    expect(await db.questionReport.count({ where: { status: "OPEN" } })).toBe(1);
  });

  it("tells the runner and the results which questions this student has reported, and nobody else", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await submitReport(u.id, id, 3, { reason: "UNCLEAR", comment: "" });

    const shown = await getQuestions(u.id, id, 0, 10);
    expect(shown.filter((q) => q.reported).map((q) => q.position)).toEqual([3]);

    // Another student served the very same question is not marked as having reported it.
    const other = await makeStudent("other@test.local");
    const otherSession = await sessionWith(other.id, [await questionAt(id, 3)]);
    expect((await getQuestions(other.id, otherSession, 0, 10)).map((q) => q.reported)).toEqual([false]);

    await finishSession(u.id, id);
    const results = await getResults(u.id, id);
    expect(results!.questions.filter((q) => q.reported).map((q) => q.position)).toEqual([3]);
  });

  it("does not put the report or the question id anywhere in what students receive", async () => {
    await seedBank();
    const u = await makeStudent();
    const id = await topicSession(u.id);
    await submitReport(u.id, id, 0, { reason: "OTHER", comment: "secret-comment-text" });
    const json = JSON.stringify(await getQuestions(u.id, id, 0, 10));
    expect(json).not.toContain("secret-comment-text");
    expect(json).not.toContain(await questionAt(id, 0));
  });
});

describe("admin review", () => {
  it("groups open reports by question, the most reported first, with who said what", async () => {
    await seedBank();
    const [popular, quiet] = await publishedIds(2);
    const a = await makeStudent("a@test.local");
    const b = await makeStudent("b@test.local");
    const c = await makeStudent("c@test.local");
    const sa = await sessionWith(a.id, [quiet, popular]);
    const sb = await sessionWith(b.id, [popular]);
    const sc = await sessionWith(c.id, [popular]);

    await submitReport(a.id, sa, 0, { reason: "OUTDATED", comment: "" }); // the quiet question
    await submitReport(a.id, sa, 1, { reason: "WRONG_ANSWER", comment: "I think C" });
    await submitReport(b.id, sb, 0, { reason: "TYPO", comment: "" });
    await submitReport(c.id, sc, 0, { reason: "UNCLEAR", comment: "Two fit" });

    const { groups, totalQuestions } = await listOpenReportGroups();
    expect(totalQuestions).toBe(2);
    expect(groups.map((g) => g.question.id)).toEqual([popular, quiet]);
    expect(groups[0].reports.map((r) => r.reporter).sort()).toEqual(["a@test.local", "b@test.local", "c@test.local"]);
    expect(groups[0].reports.find((r) => r.reporter === "c@test.local")).toMatchObject({ reason: "UNCLEAR", comment: "Two fit" });
    expect(await countReportedQuestions()).toBe(2);
    expect((await listOpenReportGroups({ questionId: quiet })).groups.map((g) => g.question.id)).toEqual([quiet]);
  });

  it("closing a question's reports closes them all, records who and why, and counts drop", async () => {
    await seedBank();
    const admin = await makeAdmin();
    const a = await makeStudent("a@test.local");
    const id = await topicSession(a.id);
    await submitReport(a.id, id, 0, { reason: "TYPO", comment: "" });
    await submitReport(a.id, id, 1, { reason: "UNCLEAR", comment: "" });
    const first = await questionAt(id, 0);

    const { closed } = await closeReports(admin.id, first, { outcome: "RESOLVED", note: "Fixed the spelling" });
    expect(closed).toBe(1);
    const row = await db.questionReport.findFirstOrThrow({ where: { questionId: first } });
    expect(row).toMatchObject({ status: "RESOLVED", resolvedById: admin.id, resolutionNote: "Fixed the spelling" });
    expect(row.resolvedAt).not.toBeNull();
    expect(await countReportedQuestions()).toBe(1);

    const history = await listClosedReports();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "RESOLVED", note: "Fixed the spelling", reporter: "a@test.local", closedBy: "admin@test.local" });
  });

  it("closing when nothing is open is a clear not-found, and a closed report lets the student report again", async () => {
    await seedBank();
    const admin = await makeAdmin();
    const a = await makeStudent("a@test.local");
    const id = await topicSession(a.id);
    const questionId = await questionAt(id, 0);
    await expect(closeReports(admin.id, questionId, { outcome: "DISMISSED", note: "" })).rejects.toMatchObject({ status: 404 });

    await submitReport(a.id, id, 0, { reason: "TYPO", comment: "" });
    await closeReports(admin.id, questionId, { outcome: "DISMISSED", note: "" });
    await submitReport(a.id, id, 0, { reason: "UNCLEAR", comment: "still unclear" });
    const rows = await db.questionReport.findMany({ where: { questionId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["DISMISSED", "OPEN"]);
    // The student is shown as having reported it again.
    expect((await getQuestions(a.id, id, 0, 10))[0].reported).toBe(true);
  });

  it("a closed report no longer shows the student as having reported", async () => {
    await seedBank();
    const admin = await makeAdmin();
    const a = await makeStudent("a@test.local");
    const id = await topicSession(a.id);
    await submitReport(a.id, id, 0, { reason: "TYPO", comment: "" });
    await closeReports(admin.id, await questionAt(id, 0), { outcome: "RESOLVED", note: "" });
    expect((await getQuestions(a.id, id, 0, 10))[0].reported).toBe(false);
  });
});
