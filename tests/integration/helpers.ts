import { db } from "@/lib/db";
import type { AiClient } from "@/lib/ai/client";

/** Empties every table so each test starts from nothing. Only ever called against the _test database. */
export async function resetDb() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("resetDb refused: not the test database");
  await db.$executeRawUnsafe(
    `TRUNCATE "AiSuggestion","AiRun","Answer","SessionQuestion","PracticeSession","Bookmark","Question","AuthToken","Account","RateLimit","User" RESTART IDENTITY CASCADE`,
  );
}

export async function makeAdmin(email = "admin@test.local") {
  return db.user.create({ data: { email, name: "Admin", role: "ADMIN", passwordHash: "x", emailVerified: new Date() } });
}

export async function makeStudent(email = "student@test.local") {
  return db.user.create({ data: { email, name: "Student", role: "STUDENT", passwordHash: "x", emailVerified: new Date() } });
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
