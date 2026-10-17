import { db } from "@/lib/db";
import type { AiClient } from "@/lib/ai/client";

/**
 * Creates a bank of tagged questions quickly. `published` ones are visible to students; the extra
 * draft/in-review/retired ones must never be served.
 */
export async function seedBank(opts: { pre?: number; cli?: number; extraNonPublished?: boolean } = {}) {
  const { pre = 60, cli = 60, extraNonPublished = true } = opts;
  const rows = [];
  const mk = (i: number, section: "PRECLINICAL" | "CLINICAL", status: "PUBLISHED" | "DRAFT" | "IN_REVIEW" | "RETIRED") => {
    const stem = `${status} ${section} bank question ${i}: choose the best option for scenario ${i}`;
    return {
      stem,
      options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`],
      correctIndex: i % 4,
      explanation: `Explanation ${i}`,
      section,
      discipline: section === "PRECLINICAL" ? (i % 2 ? "Anatomy" : "Physiology") : i % 2 ? "Surgery" : "Paediatrics",
      subtopic: section === "PRECLINICAL" ? (i % 2 ? "Thorax" : "Respiratory") : i % 2 ? "Trauma" : "Neonatology",
      status,
      stemNorm: stem.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
      contentHash: `bank-${status}-${section}-${i}`,
    };
  };
  for (let i = 0; i < pre; i++) rows.push(mk(i, "PRECLINICAL", "PUBLISHED"));
  for (let i = 0; i < cli; i++) rows.push(mk(i, "CLINICAL", "PUBLISHED"));
  if (extraNonPublished) {
    for (const status of ["DRAFT", "IN_REVIEW", "RETIRED"] as const) {
      for (let i = 0; i < 5; i++) rows.push(mk(i, "PRECLINICAL", status), mk(i, "CLINICAL", status));
    }
  }
  await db.question.createMany({ data: rows });
}

/** The display slot (0-3) that holds the correct option for a question in a session. */
export async function correctSlot(sessionId: string, position: number) {
  const sq = await db.sessionQuestion.findUniqueOrThrow({ where: { sessionId_position: { sessionId, position } }, include: { question: true } });
  return sq.optionOrder.indexOf(sq.question.correctIndex);
}

/** Empties every table so each test starts from nothing. Only ever called against the _test database. */
export async function resetDb() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("resetDb refused: not the test database");
  await db.$executeRawUnsafe(
    `TRUNCATE "QuestionReport","AiSuggestion","AiRun","Answer","SessionQuestion","PracticeSession","Bookmark","Question","AuthToken","Account","RateLimit","Payment","User" RESTART IDENTITY CASCADE`,
  );
}

export async function makeAdmin(email = "admin@test.local") {
  return db.user.create({ data: { email, name: "Admin", role: "ADMIN", passwordHash: "x", emailVerified: new Date() } });
}

/**
 * A student. Premium by default, so tests about practice are not about payment; pass `{ premium: false }` for a free account.
 */
export async function makeStudent(email = "student@test.local", opts: { premium?: boolean } = {}) {
  const premium = opts.premium !== false;
  return db.user.create({
    data: { email, name: "Student", role: "STUDENT", passwordHash: "x", emailVerified: new Date(), ...(premium && { premiumAt: new Date(), premiumSource: "ADMIN" }) },
  });
}

let counter = 0;
export async function makeQuestion(over: Partial<{ stem: string; status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED"; section: "PRECLINICAL" | "CLINICAL" | null; discipline: string | null; subtopic: string | null; explanation: string; correctIndex: number }> = {}) {
  counter++;
  const stem = over.stem ?? `Integration question number ${counter}: which structure is described in scenario ${counter}?`;
  const tagged = over.section !== undefined ? over.section !== null : false;
  return db.question.create({
    data: {
      stem,
      options: [`Option A ${counter}`, `Option B ${counter}`, `Option C ${counter}`, `Option D ${counter}`],
      correctIndex: over.correctIndex ?? 0,
      explanation: over.explanation ?? "",
      section: over.section ?? null,
      discipline: tagged ? (over.discipline ?? null) : null,
      subtopic: tagged ? (over.subtopic ?? null) : null,
      status: over.status ?? "DRAFT",
      stemNorm: stem.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
      contentHash: `hash-${counter}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

/**
 * Like fakeAi, but decides each reply from the request itself. Needed when several questions are
 * processed concurrently and replies cannot be queued in a fixed order.
 */
export function fakeAiWith(respond: (params: Record<string, unknown>) => Reply) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        const r = respond(params);
        if (r instanceof Error) throw r;
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

type Reply = { parsed: unknown; stop?: string; usage?: { input: number; output: number; cache?: number } } | Error;

/** Replays canned model replies, in order, and records every request. */
export function fakeAi(replies: Reply[]) {
  const calls: Record<string, unknown>[] = [];
  const queue = [...replies];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        const r = queue.shift();
        if (!r) throw new Error("fake AI ran out of replies");
        if (r instanceof Error) throw r;
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
