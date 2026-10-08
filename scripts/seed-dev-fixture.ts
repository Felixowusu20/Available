import "dotenv/config";
import { db } from "../src/lib/db";
import { insertQuestionIfNew } from "../src/lib/question-store";
import { flatTaxonomy } from "../src/lib/taxonomy";

// DEVELOPMENT / TEST ONLY. Generates obviously-synthetic PUBLISHED questions so the app and the
// e2e tests have a bank big enough for a 200-question mock. Never run in production.
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed dev fixture in production");

  const perSection = Number(process.env.DEV_FIXTURE_PER_SECTION ?? 120);
  const slots = flatTaxonomy();
  let created = 0;

  for (const section of ["PRECLINICAL", "CLINICAL"] as const) {
    const pool = slots.filter((s) => s.section === section);
    for (let i = 0; i < perSection; i++) {
      const tag = pool[i % pool.length];
      const n = i + 1;
      const label = `${section === "PRECLINICAL" ? "P" : "C"}${n}`;
      const correctIndex = i % 4;
      const options = [0, 1, 2, 3].map((k) => `Dev option ${label}-${k + 1}`);
      const res = await insertQuestionIfNew({
        stem: `[DEV FIXTURE ${label}] Placeholder question about ${tag.discipline} (${tag.subtopic}). Choose option ${correctIndex + 1}.`,
        options,
        correctIndex,
        explanation: `Synthetic explanation for ${label}: option ${correctIndex + 1} is marked correct by construction.`,
        section,
        discipline: tag.discipline,
        subtopic: tag.subtopic,
        difficulty: (["EASY", "MEDIUM", "HARD"] as const)[i % 3],
        source: "dev-fixture",
        status: "PUBLISHED",
      });
      if (res.created) created++;
    }
  }
  console.log(`Dev fixture: ${created} new questions (${perSection} per section target).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
