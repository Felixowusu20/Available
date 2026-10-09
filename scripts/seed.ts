import "./load-env";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { extractLegacy, type LegacyEntry } from "../src/lib/legacy-extract";
import { questionInputSchema } from "../src/lib/question-schema";
import { insertQuestionIfNew } from "../src/lib/question-store";
import { isValidTags, type SectionName } from "../src/lib/taxonomy";
import { normaliseStem, shuffleOptions } from "../src/lib/text";
import mapFile from "./legacy-topic-map.json";
import tagFile from "./legacy-question-tags.json";

// Usage:
//   npm run db:seed -- [path/to/mdc-mock-200.html] [--check] [--print-fingerprint]
//
// Imports the legacy 200 questions as PUBLISHED. Idempotent: questions whose stem already exists are skipped.
//   --check              validate everything and print a summary, but write nothing
//   --print-fingerprint  print the fingerprint to paste into scripts/legacy-question-tags.json
//
// Tags: section comes from the array (PRE = PRECLINICAL, CLI = CLINICAL), discipline from
// scripts/legacy-topic-map.json, and subtopic from scripts/legacy-question-tags.json.

type TopicEntry = { discipline: string; subtopic?: string };
const maps = { PRE: mapFile.PRE as Record<string, TopicEntry>, CLI: mapFile.CLI as Record<string, TopicEntry> };
const perQuestion = tagFile.tags as unknown as Record<string, string | [string, string]>;
const SECTION: Record<"PRE" | "CLI", SectionName> = { PRE: "PRECLINICAL", CLI: "CLINICAL" };

const fingerprintOf = (all: LegacyEntry[]) => createHash("sha256").update(all.map((e) => normaliseStem(e.stem)).join("\n")).digest("hex");

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const fileArg = args.find((a) => !a.startsWith("--")) ?? process.env.LEGACY_SEED_FILE ?? "mdc-mock-200.html";
  const file = path.resolve(fileArg);
  if (!existsSync(file)) {
    throw new Error(`Seed file not found: ${file}\nPass its path: npm run db:seed -- path/to/mdc-mock-200.html`);
  }

  const legacy = extractLegacy(readFileSync(file, "utf8"));
  console.log(`Read ${legacy.PRE.length} preclinical and ${legacy.CLI.length} clinical questions.`);

  const fingerprint = fingerprintOf([...legacy.PRE, ...legacy.CLI]);
  if (args.includes("--print-fingerprint")) {
    console.log(fingerprint);
    return;
  }
  if (tagFile.fingerprint !== fingerprint) {
    throw new Error(
      "The questions in this file do not match the ones scripts/legacy-question-tags.json was written for.\n" +
        "Re-check the tags against the new file, then set \"fingerprint\" to:\n" +
        fingerprint,
    );
  }

  // Resolve and validate every question before touching the database.
  const problems: string[] = [];
  const plan: { key: string; entry: LegacyEntry; section: SectionName; discipline: string; subtopic: string }[] = [];
  for (const k of ["PRE", "CLI"] as const) {
    legacy[k].forEach((entry, i) => {
      const key = `${k}:${i}`;
      const topic = maps[k][entry.topic];
      if (!topic) return void problems.push(`${key}: topic "${entry.topic}" is not in legacy-topic-map.json`);
      const override = perQuestion[key];
      const discipline = Array.isArray(override) ? override[0] : topic.discipline;
      const subtopic = Array.isArray(override) ? override[1] : (override ?? topic.subtopic);
      if (!subtopic) return void problems.push(`${key}: no subtopic (topic "${entry.topic}")`);
      if (!isValidTags(SECTION[k], discipline, subtopic)) {
        return void problems.push(`${key}: ${SECTION[k]} / ${discipline} / ${subtopic} is not in the taxonomy`);
      }
      plan.push({ key, entry, section: SECTION[k], discipline, subtopic });
    });
  }
  const unused = Object.keys(perQuestion).filter((k) => !plan.some((p) => p.key === k));
  if (unused.length) problems.push(`legacy-question-tags.json has keys for questions that do not exist: ${unused.join(", ")}`);
  if (problems.length) throw new Error(`Seed aborted. ${problems.length} problem(s):\n${problems.join("\n")}`);

  const tally = new Map<string, number>();
  for (const p of plan) tally.set(`${p.section} / ${p.discipline}`, (tally.get(`${p.section} / ${p.discipline}`) ?? 0) + 1);
  console.log("\nQuestions per discipline:");
  for (const [k, n] of [...tally].sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);
  if (checkOnly) return void console.log("\nCheck passed. Nothing was written (--check).");

  let created = 0;
  let skipped = 0;
  for (const p of plan) {
    const { options, correctIndex } = shuffleOptions([p.entry.correct, ...p.entry.wrong]);
    const input = questionInputSchema.parse({
      stem: p.entry.stem,
      options,
      correctIndex,
      explanation: p.entry.explanation,
      section: p.section,
      discipline: p.discipline,
      subtopic: p.subtopic,
      source: "mdc-mock-200",
      status: "PUBLISHED",
      legacyTopic: p.entry.topic,
    });
    const res = await insertQuestionIfNew(input);
    if (res.created) created++;
    else skipped++;
  }
  console.log(`\nSeed complete: ${created} created, ${skipped} already present.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
