import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { extractLegacy, type LegacyEntry } from "../src/lib/legacy-extract";
import { questionInputSchema } from "../src/lib/question-schema";
import { insertQuestionIfNew } from "../src/lib/question-store";
import { isValidTags, type SectionName } from "../src/lib/taxonomy";
import { shuffleOptions } from "../src/lib/text";
import mapFile from "./legacy-topic-map.json";

// Usage:
//   npm run db:seed -- [path/to/mdc-mock-200.html] [--report-topics]
// Imports the legacy 200 questions as PUBLISHED. Idempotent: questions whose stem already exists are skipped.

type TopicMap = Record<string, { discipline: string; subtopic: string }>;
const maps = { PRE: mapFile.PRE as TopicMap, CLI: mapFile.CLI as TopicMap };
const SECTION: Record<"PRE" | "CLI", SectionName> = { PRE: "PRECLINICAL", CLI: "CLINICAL" };

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes("--report-topics");
  const fileArg = args.find((a) => !a.startsWith("--")) ?? process.env.LEGACY_SEED_FILE ?? "mdc-mock-200.html";
  const file = path.resolve(fileArg);
  if (!existsSync(file)) {
    throw new Error(`Seed file not found: ${file}\nPass its path: npm run db:seed -- path/to/mdc-mock-200.html`);
  }

  const legacy = extractLegacy(readFileSync(file, "utf8"));
  console.log(`Read ${legacy.PRE.length} preclinical and ${legacy.CLI.length} clinical questions.`);

  const unmapped: Record<"PRE" | "CLI", Set<string>> = { PRE: new Set(), CLI: new Set() };
  const bad: string[] = [];
  for (const key of ["PRE", "CLI"] as const) {
    for (const e of legacy[key]) {
      const m = maps[key][e.topic];
      if (!m) unmapped[key].add(e.topic);
      else if (!isValidTags(SECTION[key], m.discipline, m.subtopic)) {
        bad.push(`${key} "${e.topic}" -> ${m.discipline} / ${m.subtopic} is not a valid ${SECTION[key]} taxonomy entry`);
      }
    }
  }

  if (reportOnly || unmapped.PRE.size || unmapped.CLI.size || bad.length) {
    const skeleton = { PRE: Object.fromEntries([...unmapped.PRE].map((t) => [t, { discipline: "", subtopic: "" }])), CLI: Object.fromEntries([...unmapped.CLI].map((t) => [t, { discipline: "", subtopic: "" }])) };
    if (bad.length) console.error(bad.join("\n"));
    if (unmapped.PRE.size || unmapped.CLI.size) {
      console.error("\nTopics without a mapping in scripts/legacy-topic-map.json (fill these in):");
      console.error(JSON.stringify(skeleton, null, 2));
    }
    if (!reportOnly) throw new Error("Seed aborted: fix the topic map first.");
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const key of ["PRE", "CLI"] as const) {
    for (const e of legacy[key] as LegacyEntry[]) {
      const m = maps[key][e.topic];
      const { options, correctIndex } = shuffleOptions([e.correct, ...e.wrong]);
      const input = questionInputSchema.parse({
        stem: e.stem,
        options,
        correctIndex,
        explanation: e.explanation,
        section: SECTION[key],
        discipline: m.discipline,
        subtopic: m.subtopic,
        source: "mdc-mock-200",
        status: "PUBLISHED",
        legacyTopic: e.topic,
      });
      const res = await insertQuestionIfNew(input);
      if (res.created) created++;
      else skipped++;
    }
  }
  console.log(`Seed complete: ${created} created, ${skipped} already present.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
