import { beforeEach, describe, expect, it } from "vitest";
import { parseImport } from "@/lib/admin/import";
import { commitRows, previewRows } from "@/lib/admin/import-service";
import { bulkSetStatus } from "@/lib/admin/questions";
import { consumeToken, issueToken } from "@/lib/auth-tokens";
import { db } from "@/lib/db";
import { rateLimit, rateLimitPeek } from "@/lib/rate-limit";
import { makeAdmin, makeQuestion, makeStudent, resetDb } from "./helpers";

beforeEach(resetDb);

describe("rate limiter", () => {
  it("allows exactly `limit` hits per window, then blocks with a retry time", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit("t:block", 3, 60));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[4].retryAfterSeconds).toBeGreaterThan(0);
    expect(results[4].retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate counters per key", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("t:a", 3, 60);
    expect((await rateLimit("t:a", 3, 60)).ok).toBe(false);
    expect((await rateLimit("t:b", 3, 60)).ok).toBe(true);
  });

  it("peek reads the state without using up an attempt", async () => {
    for (let i = 0; i < 20; i++) expect((await rateLimitPeek("t:peek", 2, 60)).ok).toBe(true);
    await rateLimit("t:peek", 2, 60);
    expect((await rateLimitPeek("t:peek", 2, 60)).ok).toBe(true);
    await rateLimit("t:peek", 2, 60);
    expect((await rateLimitPeek("t:peek", 2, 60)).ok).toBe(false);
  });

  it("stays correct under concurrent hits (no lost updates)", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimit("t:race", 5, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});

describe("one-time email tokens", () => {
  it("works once, and only for the right purpose", async () => {
    const u = await makeStudent();
    const token = await issueToken(u.id, "VERIFY_EMAIL");
    expect(await consumeToken(token, "RESET_PASSWORD")).toBeNull();
    expect(await consumeToken(token, "VERIFY_EMAIL")).toBe(u.id);
    expect(await consumeToken(token, "VERIFY_EMAIL")).toBeNull();
  });

  it("stores only a hash, never the token itself", async () => {
    const u = await makeStudent();
    const token = await issueToken(u.id, "RESET_PASSWORD");
    const rows = await db.authToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires, and a newer token invalidates an older unused one", async () => {
    const u = await makeStudent();
    const first = await issueToken(u.id, "VERIFY_EMAIL");
    const second = await issueToken(u.id, "VERIFY_EMAIL");
    expect(await consumeToken(first, "VERIFY_EMAIL")).toBeNull();
    await db.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeToken(second, "VERIFY_EMAIL")).toBeNull();
  });

  it("two simultaneous uses of one token succeed exactly once", async () => {
    const u = await makeStudent();
    const token = await issueToken(u.id, "RESET_PASSWORD");
    const results = await Promise.all([consumeToken(token, "RESET_PASSWORD"), consumeToken(token, "RESET_PASSWORD"), consumeToken(token, "RESET_PASSWORD")]);
    expect(results.filter((r) => r === u.id)).toHaveLength(1);
  });
});

describe("import", () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    stem: `Import test ${n}: which structure carries the oxygenated blood in scenario number ${n}?`,
    options: ["First", "Second", "Third", "Fourth"],
    correct: "B",
    explanation: "Because.",
    ...extra,
  });
  const text = (rows: unknown[]) => JSON.stringify(rows);

  it("imports valid rows as DRAFT, keeps good tags, leaves the rest untagged, and skips invalid rows", async () => {
    const admin = await makeAdmin();
    const rows = parseImport(text([row(1, { discipline: "anatomy", subtopic: "thorax" }), row(2), { stem: "broken", options: ["a", "b"] }]), "json").rows;
    const preview = await previewRows(rows);
    expect(preview.totals).toMatchObject({ total: 3, importable: 2, errors: 1, untagged: 1 });

    const result = await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: "import:test.json" });
    expect(result.created).toBe(2);
    expect(result.skipped.errors).toBe(1);
    const saved = await db.question.findMany({ orderBy: { stem: "asc" } });
    expect(saved.every((q) => q.status === "DRAFT" && q.createdById === admin.id && q.source === "import:test.json")).toBe(true);
    expect(saved[0]).toMatchObject({ section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Thorax", correctIndex: 1 });
    expect(saved[1].section).toBeNull();
    expect(result.untaggedIds).toEqual([saved[1].id]);
  });

  it("re-importing the same file creates nothing, and repeats inside one file are skipped", async () => {
    const admin = await makeAdmin();
    const rows = parseImport(text([row(10), row(11), row(10)]), "json").rows;
    // "warning" because these rows are untagged; the third repeats the first
    expect((await previewRows(rows)).rows.map((r) => r.status)).toEqual(["warning", "warning", "duplicate"]);
    const first = await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: null });
    expect(first.created).toBe(2);
    const second = await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: null });
    expect(second.created).toBe(0);
    expect(await db.question.count()).toBe(2);
  });

  it("flags a near-duplicate of an existing question, and can skip it on request", async () => {
    const admin = await makeAdmin();
    await makeQuestion({ stem: "A 24-year-old footballer falls on an outstretched hand and has tenderness in the anatomical snuffbox. Which bone is at greatest risk of avascular necrosis?" });
    const rows = parseImport(
      text([{ stem: "A 24 year old footballer falls on an outstretched hand and has tenderness in the anatomical snuffbox. Which bone is at greatest risk of avascular necrosis", options: ["Scaphoid", "Lunate", "Hamate", "Capitate"], correct: "A" }]),
      "json",
    ).rows;
    const preview = await previewRows(rows);
    expect(preview.rows[0].status).toBe("similar");
    expect(preview.rows[0].similarTo?.similarity).toBeGreaterThan(0.8);

    const skipped = await commitRows(admin.id, rows, { skipSimilar: true, defaultSource: null });
    expect(skipped.created).toBe(0);
    expect(skipped.skipped.similar).toBe(1);
    const kept = await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: null });
    expect(kept.created).toBe(1);
  });

  it("an imported file cannot publish anything, whatever it says", async () => {
    const admin = await makeAdmin();
    const rows = parseImport(text([row(20, { status: "PUBLISHED", discipline: "Anatomy", subtopic: "Thorax" })]), "json").rows;
    await commitRows(admin.id, rows, { skipSimilar: false, defaultSource: null });
    expect((await db.question.findFirstOrThrow()).status).toBe("DRAFT");
  });
});

describe("database safety nets (defence in depth)", () => {
  it("the database itself refuses to publish an untagged question", async () => {
    const q = await makeQuestion();
    await expect(db.question.update({ where: { id: q.id }, data: { status: "PUBLISHED" } })).rejects.toThrow();
    await expect(db.question.update({ where: { id: q.id }, data: { status: "IN_REVIEW" } })).rejects.toThrow();
  });

  it("the database refuses a question that does not have exactly 4 options", async () => {
    const q = await makeQuestion();
    await expect(db.question.update({ where: { id: q.id }, data: { options: ["a", "b", "c"] } })).rejects.toThrow();
    await expect(db.question.update({ where: { id: q.id }, data: { correctIndex: 4 } })).rejects.toThrow();
  });

  it("bulk publish skips untagged questions and reports them", async () => {
    const admin = await makeAdmin();
    const tagged = await makeQuestion({ section: "PRECLINICAL", discipline: "Anatomy", subtopic: "Thorax" });
    const untagged = await makeQuestion();
    const res = await bulkSetStatus(admin.id, [tagged.id, untagged.id], "PUBLISHED");
    expect(res).toEqual({ updated: 1, skippedUntagged: 1 });
    expect(await db.question.findUniqueOrThrow({ where: { id: tagged.id } })).toMatchObject({ status: "PUBLISHED", reviewedById: admin.id });
    expect((await db.question.findUniqueOrThrow({ where: { id: untagged.id } })).status).toBe("DRAFT");
  });

  it("the trigram index that near-duplicate detection relies on exists", async () => {
    const idx = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'Question_stemNorm_trgm_idx'`;
    expect(idx[0].indexdef).toMatch(/USING gin .*gin_trgm_ops/);
  });
});
