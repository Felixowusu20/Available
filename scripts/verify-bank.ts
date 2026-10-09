import "./load-env";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/practice/service";

// Read-only report on the question bank, plus a dry-run of the mock rules: it builds a real 200-question
// mock for a throwaway check, verifies the 100/100 and 25/25-per-block rule, then deletes that session.
async function main() {
  const q = await db.question.groupBy({ by: ["status", "section"], _count: true, orderBy: [{ status: "asc" }, { section: "asc" }] });
  console.log("Questions by status and section:");
  for (const r of q) console.log(`  ${r.status.padEnd(10)} ${String(r.section ?? "(untagged)").padEnd(12)} ${r._count}`);

  const bySource = await db.$queryRaw<{ grp: string; n: bigint }[]>`SELECT CASE WHEN source = 'mdc-mock-200' THEN 'seed (mdc-mock-200)' WHEN source LIKE 'Batch%' THEN 'your file (Batch ...)' ELSE coalesce(source, '(none)') END AS grp, count(*) AS n FROM "Question" GROUP BY 1 ORDER BY 1`;
  console.log("\nBy origin:");
  for (const r of bySource) console.log(`  ${r.grp.padEnd(24)} ${r.n}`);

  const disc = await db.$queryRaw<{ section: string; discipline: string; n: bigint }[]>`SELECT section::text, discipline, count(*) AS n FROM "Question" WHERE status = 'PUBLISHED' GROUP BY 1, 2 ORDER BY 1, 3 DESC`;
  console.log("\nPublished per discipline:");
  for (const r of disc) console.log(`  ${r.section.padEnd(12)} ${r.discipline.padEnd(28)} ${r.n}`);

  const bad = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Question" WHERE cardinality(options) <> 4 OR "correctIndex" NOT BETWEEN 0 AND 3 OR btrim(explanation) = ''`;
  const pos = await db.$queryRaw<{ i: number; n: bigint }[]>`SELECT "correctIndex" AS i, count(*) AS n FROM "Question" GROUP BY 1 ORDER BY 1`;
  console.log(`\nQuestions with a malformed option set, key or missing explanation: ${bad[0].n}`);
  console.log(`Position of the correct answer A/B/C/D: ${pos.map((p) => p.n).join(" / ")}`);

  // Mock-rule dry run on a throwaway student-less check: use the admin account, then clean up.
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const sizes = [50, 100, 200] as const;
  console.log("\nMock composition (built for real, then deleted):");
  for (const size of sizes) {
    const id = await createSession(admin.id, { kind: "MOCK", size, mode: "EXAM" });
    const rows = await db.sessionQuestion.findMany({ where: { sessionId: id }, include: { question: { select: { section: true, status: true } } } });
    const blocks = [...new Set(rows.map((r) => r.blockIndex))].sort();
    const ok = blocks.every((b) => {
      const inBlock = rows.filter((r) => r.blockIndex === b);
      return inBlock.length === 50 && inBlock.filter((r) => r.question.section === "PRECLINICAL").length === 25;
    });
    const pre = rows.filter((r) => r.question.section === "PRECLINICAL").length;
    console.log(`  ${String(size).padStart(3)} questions: ${pre} preclinical / ${rows.length - pre} clinical, every block 25/25: ${ok ? "YES" : "NO"}, all published: ${rows.every((r) => r.question.status === "PUBLISHED") ? "YES" : "NO"}`);
    await db.practiceSession.delete({ where: { id } });
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
