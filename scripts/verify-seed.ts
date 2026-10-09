import "./load-env";
import { db } from "../src/lib/db";

// Read-only summary of the question bank by source, status and section. Handy after seeding or importing.
async function main() {
  const rows = await db.question.groupBy({ by: ["source", "status", "section"], _count: true, orderBy: [{ source: "asc" }, { status: "asc" }, { section: "asc" }] });
  console.table(rows.map((r) => ({ source: r.source ?? "(none)", status: r.status, section: r.section ?? "(untagged)", count: r._count })));

  const real = await db.question.findMany({ where: { source: "mdc-mock-200" }, select: { options: true, correctIndex: true, explanation: true, discipline: true } });
  const badOptions = real.filter((q) => q.options.length !== 4).length;
  const noExplanation = real.filter((q) => !q.explanation.trim()).length;
  const positions = [0, 1, 2, 3].map((i) => real.filter((q) => q.correctIndex === i).length);
  console.log(`\nmdc-mock-200: ${real.length} questions, ${badOptions} without exactly 4 options, ${noExplanation} without an explanation.`);
  console.log(`Correct answer position A/B/C/D after shuffling: ${positions.join(" / ")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
