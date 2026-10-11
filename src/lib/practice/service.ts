import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { composeList, composeMock, randomOptionOrder, type Composed } from "@/lib/practice/compose";
import { ServiceError } from "@/lib/practice/http";
import type { CreateSessionInput } from "@/lib/practice/schemas";
import { summarise, type ResultRow } from "@/lib/practice/scoring";
import { openReportedIds } from "@/lib/reports";
import { deadlineOf, isPastGrace, timeLimitSeconds } from "@/lib/practice/timing";

type Session = NonNullable<Awaited<ReturnType<typeof findOwned>>>;

// ---------------------------------------------------------------------------------------------
// Public payload types (what the browser receives). Nothing here ever includes the correct
// answer or explanation unless the session rules reveal it.
// ---------------------------------------------------------------------------------------------

export type Feedback = { correctSlot: number; explanation: string; section: string; discipline: string; subtopic: string };

export type QuestionPayload = {
  position: number;
  blockIndex: number;
  stem: string;
  options: string[];
  selected: number | null;
  guessed: boolean;
  flagged: boolean;
  bookmarked: boolean;
  /** This student has an open report on the question. */
  reported: boolean;
  timeSpentMs: number;
  feedback?: Feedback;
};

export type MapEntry = { answered: boolean; flagged: boolean; result: "correct" | "wrong" | "unanswered" | null };

export type SessionState = {
  id: string;
  kind: "MOCK" | "TOPIC" | "REDO_MISSED" | "BOOKMARKS";
  mode: "LEARN" | "EXAM";
  questionCount: number;
  startedAt: string;
  deadline: string | null;
  /** Server clock at response time; the client uses it to correct for a wrong device clock. */
  serverNow: string;
  finished: boolean;
  switchedFromExam: boolean;
  map: MapEntry[];
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function findOwned(userId: string, id: string) {
  return db.practiceSession.findFirst({ where: { id, userId } });
}

/** Loads a session the user owns (404 otherwise) and finalises it if its exam time has run out. */
async function loadSession(userId: string, id: string): Promise<Session> {
  const s = await findOwned(userId, id);
  if (!s) throw new ServiceError(404, "Session not found");
  if (!s.finishedAt && s.mode === "EXAM" && isPastGrace(s.startedAt, s.timeLimitSeconds)) {
    await finalise(s);
    return (await findOwned(userId, id))!;
  }
  return s;
}

async function finalise(s: { id: string; startedAt: Date; timeLimitSeconds: number | null; finishedAt: Date | null }) {
  if (s.finishedAt) return;
  const answers = await db.answer.findMany({ where: { sessionId: s.id }, select: { selectedIndex: true, guessed: true, correct: true } });
  const answered = answers.filter((a) => a.selectedIndex !== null);
  const deadline = deadlineOf(s.startedAt, s.timeLimitSeconds);
  const now = new Date();
  await db.practiceSession.updateMany({
    where: { id: s.id, finishedAt: null },
    data: {
      finishedAt: deadline && deadline < now ? deadline : now,
      answeredCount: answered.length,
      correctCount: answered.filter((a) => a.correct).length,
      guessedCount: answered.filter((a) => a.guessed).length,
      correctGuessed: answered.filter((a) => a.guessed && a.correct).length,
    },
  });
}

const isRevealed = (s: { finishedAt: Date | null; mode: "LEARN" | "EXAM" }, answered: boolean) =>
  s.finishedAt !== null || (s.mode === "LEARN" && answered);

function feedbackFor(
  order: number[],
  q: { correctIndex: number; explanation: string; section: string | null; discipline: string | null; subtopic: string | null },
): Feedback {
  // Published questions always have tags (DB CHECK); the fallbacks only cover retired/legacy rows.
  return {
    correctSlot: order.indexOf(q.correctIndex),
    explanation: q.explanation,
    section: q.section ?? "",
    discipline: q.discipline ?? "Untagged",
    subtopic: q.subtopic ?? "",
  };
}

// ---------------------------------------------------------------------------------------------
// Creating sessions
// ---------------------------------------------------------------------------------------------

async function seenQuestionIds(userId: string): Promise<Set<string>> {
  const rows = await db.answer.findMany({ where: { userId, selectedIndex: { not: null } }, select: { questionId: true }, distinct: ["questionId"] });
  return new Set(rows.map((r) => r.questionId));
}

/** Questions whose most recent answer by this user was wrong, and which are still published. */
async function missedQuestionIds(userId: string): Promise<string[]> {
  const rows = await db.answer.findMany({
    where: { userId, selectedIndex: { not: null } },
    orderBy: { answeredAt: "desc" },
    select: { questionId: true, correct: true },
  });
  const latest = new Map<string, boolean>();
  for (const r of rows) if (!latest.has(r.questionId)) latest.set(r.questionId, r.correct === true);
  const missed = [...latest].filter(([, ok]) => !ok).map(([id]) => id);
  if (missed.length === 0) return [];
  const live = await db.question.findMany({ where: { id: { in: missed }, status: "PUBLISHED" }, select: { id: true } });
  return live.map((q) => q.id);
}

export async function createSession(userId: string, input: CreateSessionInput): Promise<string> {
  const seen = await seenQuestionIds(userId);
  let composed: Composed[];
  let filter: Prisma.InputJsonValue | undefined;

  if (input.kind === "MOCK") {
    const rows = await db.question.findMany({ where: { status: "PUBLISHED", section: { not: null } }, select: { id: true, section: true } });
    const pool = rows.flatMap((r) => (r.section ? [{ id: r.id, section: r.section }] : []));
    composed = composeMock(pool, input.size, seen);
  } else if (input.kind === "TOPIC") {
    const or: Prisma.QuestionWhereInput[] = [
      ...(input.disciplines.length ? [{ discipline: { in: input.disciplines } }] : []),
      ...input.subtopics.map((s) => ({ discipline: s.discipline, subtopic: s.subtopic })),
    ];
    const pool = await db.question.findMany({ where: { status: "PUBLISHED", OR: or }, select: { id: true } });
    if (pool.length === 0) throw new ServiceError(422, "No published questions match that selection yet.");
    composed = composeList(pool, input.count, seen);
    filter = { disciplines: input.disciplines, subtopics: input.subtopics };
  } else if (input.kind === "REDO_MISSED") {
    const ids = await missedQuestionIds(userId);
    if (ids.length === 0) throw new ServiceError(422, "You have no missed questions to redo yet.");
    composed = composeList(ids.map((id) => ({ id })), input.count, new Set());
  } else {
    const marks = await db.bookmark.findMany({ where: { userId, question: { status: "PUBLISHED" } }, select: { questionId: true } });
    if (marks.length === 0) throw new ServiceError(422, "You have no bookmarked questions yet.");
    composed = composeList(marks.map((m) => ({ id: m.questionId })), 200, new Set());
  }

  const mode = input.mode;
  const session = await db.practiceSession.create({
    data: {
      userId,
      kind: input.kind,
      mode,
      questionCount: composed.length,
      timeLimitSeconds: mode === "EXAM" ? timeLimitSeconds(composed.length, env().EXAM_SECONDS_PER_QUESTION) : null,
      filter,
      questions: {
        create: composed.map((c) => ({
          position: c.position,
          blockIndex: c.blockIndex,
          questionId: c.questionId,
          optionOrder: randomOptionOrder(),
        })),
      },
    },
    select: { id: true },
  });
  return session.id;
}

// ---------------------------------------------------------------------------------------------
// Reading sessions
// ---------------------------------------------------------------------------------------------

export async function getState(userId: string, id: string): Promise<SessionState> {
  const s = await loadSession(userId, id);
  const rows = await db.sessionQuestion.findMany({
    where: { sessionId: id },
    orderBy: { position: "asc" },
    select: { answer: { select: { selectedIndex: true, flagged: true, correct: true } } },
  });
  const map: MapEntry[] = rows.map((r) => {
    const answered = r.answer?.selectedIndex != null;
    const revealed = isRevealed(s, answered);
    let result: MapEntry["result"] = null;
    if (revealed) result = !answered ? (s.finishedAt ? "unanswered" : null) : r.answer?.correct ? "correct" : "wrong";
    return { answered, flagged: r.answer?.flagged ?? false, result };
  });
  return {
    id: s.id,
    kind: s.kind,
    mode: s.mode,
    questionCount: s.questionCount,
    startedAt: s.startedAt.toISOString(),
    deadline: deadlineOf(s.startedAt, s.timeLimitSeconds)?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
    finished: s.finishedAt !== null,
    switchedFromExam: s.modeSwitchedAt !== null,
    map,
  };
}

export async function getQuestions(userId: string, id: string, from: number, count: number): Promise<QuestionPayload[]> {
  const s = await loadSession(userId, id);
  const rows = await db.sessionQuestion.findMany({
    where: { sessionId: id, position: { gte: from, lt: from + count } },
    orderBy: { position: "asc" },
    include: { question: true, answer: true },
  });
  const ids = rows.map((r) => r.questionId);
  const [marks, reported] = await Promise.all([
    db.bookmark.findMany({ where: { userId, questionId: { in: ids } }, select: { questionId: true } }),
    openReportedIds(userId, ids),
  ]);
  const marked = new Set(marks.map((m) => m.questionId));

  return rows.map((r) => {
    const answered = r.answer?.selectedIndex != null;
    return {
      position: r.position,
      blockIndex: r.blockIndex,
      stem: r.question.stem,
      options: r.optionOrder.map((i) => r.question.options[i]),
      selected: answered ? r.optionOrder.indexOf(r.answer!.selectedIndex!) : null,
      guessed: r.answer?.guessed ?? false,
      flagged: r.answer?.flagged ?? false,
      bookmarked: marked.has(r.questionId),
      reported: reported.has(r.questionId),
      timeSpentMs: r.answer?.timeSpentMs ?? 0,
      feedback: isRevealed(s, answered) ? feedbackFor(r.optionOrder, r.question) : undefined,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Writing answers
// ---------------------------------------------------------------------------------------------

async function loadWritable(userId: string, id: string, position: number) {
  const s = await loadSession(userId, id);
  if (s.finishedAt) throw new ServiceError(409, "This session has finished.");
  const sq = await db.sessionQuestion.findUnique({
    where: { sessionId_position: { sessionId: id, position } },
    include: { question: true, answer: true },
  });
  if (!sq) throw new ServiceError(404, "Question not found");
  return { s, sq };
}

export async function saveAnswer(
  userId: string,
  id: string,
  position: number,
  input: { selected: number | null; guessed: boolean; timeSpentMs: number },
): Promise<{ selected: number | null; feedback?: Feedback }> {
  const { s, sq } = await loadWritable(userId, id, position);
  const order = sq.optionOrder;
  const canonical = input.selected === null ? null : order[input.selected];
  const existing = sq.answer;

  // Learn mode locks an answer once given; repeating the same one (a retried request) is fine.
  if (s.mode === "LEARN" && existing?.selectedIndex != null) {
    if (canonical !== existing.selectedIndex) throw new ServiceError(409, "This answer is locked in learn mode.");
    if (input.timeSpentMs > existing.timeSpentMs) {
      await db.answer.update({ where: { sessionQuestionId: sq.id }, data: { timeSpentMs: input.timeSpentMs } });
    }
    return { selected: input.selected, feedback: feedbackFor(order, sq.question) };
  }
  if (s.mode === "LEARN" && canonical === null) throw new ServiceError(400, "Choose an option.");

  const correct = canonical === null ? null : canonical === sq.question.correctIndex;
  const data = {
    selectedIndex: canonical,
    guessed: canonical === null ? false : input.guessed,
    correct,
    timeSpentMs: Math.max(existing?.timeSpentMs ?? 0, input.timeSpentMs),
    answeredAt: canonical === null ? null : new Date(),
  };
  await db.answer.upsert({
    where: { sessionQuestionId: sq.id },
    create: { sessionQuestionId: sq.id, sessionId: id, userId, questionId: sq.questionId, ...data },
    update: data,
  });

  const revealed = isRevealed(s, canonical !== null);
  return { selected: input.selected, feedback: revealed ? feedbackFor(order, sq.question) : undefined };
}

export async function setFlag(userId: string, id: string, position: number, flagged: boolean): Promise<void> {
  const { sq } = await loadWritable(userId, id, position);
  await db.answer.upsert({
    where: { sessionQuestionId: sq.id },
    create: { sessionQuestionId: sq.id, sessionId: id, userId, questionId: sq.questionId, flagged },
    update: { flagged },
  });
}

/** Bookmarks belong to the student, so they stay editable even after a session has finished. */
export async function setBookmark(userId: string, id: string, position: number, bookmarked: boolean): Promise<void> {
  const s = await findOwned(userId, id);
  if (!s) throw new ServiceError(404, "Session not found");
  const sq = await db.sessionQuestion.findUnique({ where: { sessionId_position: { sessionId: id, position } }, select: { questionId: true } });
  if (!sq) throw new ServiceError(404, "Question not found");
  if (bookmarked) {
    await db.bookmark.upsert({
      where: { userId_questionId: { userId, questionId: sq.questionId } },
      create: { userId, questionId: sq.questionId },
      update: {},
    });
  } else {
    await db.bookmark.deleteMany({ where: { userId, questionId: sq.questionId } });
  }
}

/** One-way: answers are kept, the timer stops, and feedback shows for answered questions. */
export async function switchToLearn(userId: string, id: string): Promise<void> {
  const s = await loadSession(userId, id);
  if (s.finishedAt) throw new ServiceError(409, "This session has finished.");
  if (s.mode === "LEARN") return;
  await db.practiceSession.update({ where: { id }, data: { mode: "LEARN", modeSwitchedAt: new Date(), timeLimitSeconds: null } });
}

export async function finishSession(userId: string, id: string): Promise<void> {
  const s = await findOwned(userId, id);
  if (!s) throw new ServiceError(404, "Session not found");
  await finalise(s);
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export type ResultQuestion = {
  position: number;
  blockIndex: number;
  stem: string;
  options: string[];
  selected: number | null;
  correctSlot: number;
  explanation: string;
  guessed: boolean;
  flagged: boolean;
  reported: boolean;
  timeSpentMs: number;
  section: "PRECLINICAL" | "CLINICAL";
  discipline: string;
  subtopic: string;
  correct: boolean;
};

export async function getResults(userId: string, id: string) {
  const s = await loadSession(userId, id);
  if (!s.finishedAt) return null;
  const rows = await db.sessionQuestion.findMany({
    where: { sessionId: id },
    orderBy: { position: "asc" },
    include: { question: true, answer: true },
  });
  const reported = await openReportedIds(userId, rows.map((r) => r.questionId));
  const questions: ResultQuestion[] = rows.map((r) => {
    const answered = r.answer?.selectedIndex != null;
    return {
      position: r.position,
      blockIndex: r.blockIndex,
      stem: r.question.stem,
      options: r.optionOrder.map((i) => r.question.options[i]),
      selected: answered ? r.optionOrder.indexOf(r.answer!.selectedIndex!) : null,
      correctSlot: r.optionOrder.indexOf(r.question.correctIndex),
      explanation: r.question.explanation,
      guessed: r.answer?.guessed ?? false,
      flagged: r.answer?.flagged ?? false,
      reported: reported.has(r.questionId),
      timeSpentMs: r.answer?.timeSpentMs ?? 0,
      section: r.question.section ?? "PRECLINICAL",
      discipline: r.question.discipline ?? "Untagged",
      subtopic: r.question.subtopic ?? "Untagged",
      correct: r.answer?.correct === true,
    };
  });
  const resultRows: ResultRow[] = questions.map((q) => ({
    position: q.position,
    blockIndex: q.blockIndex,
    section: q.section,
    discipline: q.discipline,
    subtopic: q.subtopic,
    answered: q.selected !== null,
    correct: q.correct,
    guessed: q.guessed,
  }));
  return {
    session: { id: s.id, kind: s.kind, mode: s.mode, startedAt: s.startedAt, finishedAt: s.finishedAt, switchedFromExam: s.modeSwitchedAt !== null },
    summary: summarise(resultRows),
    questions,
  };
}
