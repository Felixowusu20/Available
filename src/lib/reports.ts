import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/practice/http";
import { COMMENT_MAX, type ReportInput, type ReportReasonValue } from "@/lib/report-reasons";

// ---------------------------------------------------------------------------------------------
// Student side
// ---------------------------------------------------------------------------------------------

/**
 * A student reports the question shown at `position` of one of their own sessions. Going through
 * the session means nobody can report (or probe) a question they were never served, and the browser
 * never needs a question id. Works after the session has finished, so results can be reported too.
 *
 * A student has one open report per question: sending another replaces the reason and comment.
 */
export async function submitReport(userId: string, sessionId: string, position: number, input: ReportInput): Promise<void> {
  const session = await db.practiceSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw new ServiceError(404, "Session not found");
  const sq = await db.sessionQuestion.findUnique({ where: { sessionId_position: { sessionId, position } }, select: { questionId: true } });
  if (!sq) throw new ServiceError(404, "Question not found");

  const open = { userId, questionId: sq.questionId, status: "OPEN" as const };
  const data = { reason: input.reason, comment: input.comment };
  if ((await db.questionReport.updateMany({ where: open, data })).count > 0) return;
  try {
    await db.questionReport.create({ data: { userId, questionId: sq.questionId, ...data } });
  } catch (e) {
    // Two requests raced and the other created the open report first: update that one instead.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await db.questionReport.updateMany({ where: open, data });
      return;
    }
    throw e;
  }
}

/** Which of these questions has this student already reported (open reports only)? */
export async function openReportedIds(userId: string, questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const rows = await db.questionReport.findMany({ where: { userId, status: "OPEN", questionId: { in: questionIds } }, select: { questionId: true } });
  return new Set(rows.map((r) => r.questionId));
}

// ---------------------------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------------------------

const GROUPS_PER_PAGE = 50;

export type ReportGroup = {
  question: { id: string; stem: string; options: string[]; correctIndex: number; explanation: string; status: string; discipline: string | null; subtopic: string | null };
  /** Newest first. */
  reports: { id: string; reason: ReportReasonValue; comment: string; reporter: string; at: Date }[];
};

/** How many questions have at least one open report. */
export async function countReportedQuestions(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "questionId") AS n FROM "QuestionReport" WHERE "status" = 'OPEN'`;
  return Number(rows[0]?.n ?? 0);
}

/** Questions with open reports, the most reported first, each with its reports. */
export async function listOpenReportGroups(opts: { questionId?: string } = {}): Promise<{ groups: ReportGroup[]; totalQuestions: number }> {
  const ranked = await db.questionReport.groupBy({
    by: ["questionId"],
    where: { status: "OPEN", ...(opts.questionId && { questionId: opts.questionId }) },
    _count: { _all: true },
    _max: { updatedAt: true },
    orderBy: [{ _count: { questionId: "desc" } }, { _max: { updatedAt: "desc" } }],
  });
  const shown = ranked.slice(0, GROUPS_PER_PAGE).map((r) => r.questionId);
  if (shown.length === 0) return { groups: [], totalQuestions: 0 };

  const [questions, reports] = await Promise.all([
    db.question.findMany({
      where: { id: { in: shown } },
      select: { id: true, stem: true, options: true, correctIndex: true, explanation: true, status: true, discipline: true, subtopic: true },
    }),
    db.questionReport.findMany({
      where: { status: "OPEN", questionId: { in: shown } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, questionId: true, reason: true, comment: true, updatedAt: true, user: { select: { email: true } } },
    }),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const groups = shown.flatMap((id) => {
    const question = byId.get(id);
    if (!question) return [];
    return [
      {
        question,
        reports: reports.filter((r) => r.questionId === id).map((r) => ({ id: r.id, reason: r.reason, comment: r.comment, reporter: r.user.email, at: r.updatedAt })),
      },
    ];
  });
  return { groups, totalQuestions: ranked.length };
}

/** The most recently closed reports, for the history view. */
export async function listClosedReports(opts: { questionId?: string } = {}) {
  const rows = await db.questionReport.findMany({
    where: { status: { not: "OPEN" }, ...(opts.questionId && { questionId: opts.questionId }) },
    orderBy: { resolvedAt: "desc" },
    take: 100,
    select: {
      id: true, reason: true, comment: true, status: true, resolvedAt: true, resolutionNote: true,
      question: { select: { id: true, stem: true } },
      user: { select: { email: true } },
      resolvedBy: { select: { email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    comment: r.comment,
    status: r.status as "RESOLVED" | "DISMISSED",
    closedAt: r.resolvedAt,
    note: r.resolutionNote,
    question: r.question,
    reporter: r.user.email,
    closedBy: r.resolvedBy?.email ?? null,
  }));
}

export const closeReportsSchema = z.object({
  outcome: z.enum(["RESOLVED", "DISMISSED"]),
  note: z.string().trim().max(COMMENT_MAX).default(""),
});
export type CloseReportsInput = z.infer<typeof closeReportsSchema>;

/** Closes every open report on a question: fixed (RESOLVED) or nothing to change (DISMISSED). */
export async function closeReports(adminId: string, questionId: string, input: CloseReportsInput): Promise<{ closed: number }> {
  const res = await db.questionReport.updateMany({
    where: { questionId, status: "OPEN" },
    data: { status: input.outcome, resolvedAt: new Date(), resolvedById: adminId, resolutionNote: input.note },
  });
  if (res.count === 0) throw new ServiceError(404, "There are no open reports on this question.");
  return { closed: res.count };
}
