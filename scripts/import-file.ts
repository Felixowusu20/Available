import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseImport } from "../src/lib/admin/import";
import { commitRows, previewRows } from "../src/lib/admin/import-service";
import { db } from "../src/lib/db";

// Imports a question file (JSON or CSV) with the SAME validation and duplicate detection as the admin
// Import screen. Imports always arrive as DRAFT; --publish then publishes the tagged ones from this
// file, which is an explicit admin decision.
//
//   npx tsx scripts/import-file.ts "C:\path\questions.json"                 # preview only, writes nothing
//   npx tsx scripts/import-file.ts "C:\path\questions.json" --commit        # import as drafts
//   npx tsx scripts/import-file.ts "C:\path\questions.json" --commit --publish
//
// Options: --skip-similar   leave out near-duplicates of existing questions
//          --admin <email>  record this admin as the author (default: the first admin)
//          --source <text>  source label for rows that have none (default: import:<filename>)

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--admin" && args[args.indexOf(a) - 1] !== "--source");
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

async function main() {
  if (!file) throw new Error('Usage: npx tsx scripts/import-file.ts "<file.json|file.csv>" [--commit] [--publish] [--skip-similar]');
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://unset");
  console.log(`Target database: "${url.pathname.slice(1)}" on ${url.hostname}`);

  const format = file.toLowerCase().endsWith(".csv") ? "csv" : "json";
  const { rows, fatal } = parseImport(readFileSync(file, "utf8").replace(/^\uFEFF/, ""), format);
  if (fatal) throw new Error(fatal);

  const preview = await previewRows(rows);
  const t = preview.totals;
  console.log(`\n${t.total} rows read: ${t.importable} importable, ${t.errors} with errors, ${t.duplicates} duplicates (skipped), ${t.similar} near-duplicates, ${t.untagged} untagged`);

  // What is wrong, grouped, so a few common causes can be fixed in one go.
  const notes = new Map<string, number>();
  for (const r of preview.rows) for (const m of r.messages) {
    const key = m.replace(/"[^"]*"/g, '"…"').replace(/\d+%/g, "N%");
    notes.set(key, (notes.get(key) ?? 0) + 1);
  }
  if (notes.size) {
    console.log("\nMessages (count × text):");
    for (const [m, n] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(5)} ×  ${m}`);
  }
  for (const status of ["error", "duplicate", "similar"] as const) {
    const sample = preview.rows.filter((r) => r.status === status).slice(0, 6);
    if (sample.length) {
      console.log(`\nFirst ${sample.length} "${status}" rows:`);
      for (const r of sample) console.log(`  row ${r.row}: ${r.stemPreview.slice(0, 90)}  [${r.messages[0] ?? ""}]`);
    }
  }

  if (!args.includes("--commit")) return void console.log("\nPreview only. Nothing was written. Add --commit to import as drafts.");

  const adminEmail = opt("--admin");
  const admin = await db.user.findFirst({ where: { role: "ADMIN", ...(adminEmail ? { email: adminEmail.toLowerCase() } : {}) }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No admin account found to record as the author. Create one first (npm run db:seed:admin).");

  const result = await commitRows(admin.id, rows, { skipSimilar: args.includes("--skip-similar"), defaultSource: opt("--source") ?? `import:${path.basename(file)}` });
  console.log(`\nImported ${result.created} question(s) as DRAFT. Skipped: ${result.skipped.errors} with errors, ${result.skipped.duplicates} duplicates, ${result.skipped.similar} near-duplicates.`);
  console.log(`${result.untaggedIds.length} of them are untagged (they cannot be published until tagged).`);

  if (args.includes("--publish")) {
    const publishable = await db.question.updateMany({
      where: { id: { in: result.ids }, status: "DRAFT", section: { not: null }, discipline: { not: null }, subtopic: { not: null } },
      data: { status: "PUBLISHED", reviewedById: admin.id, publishedAt: new Date() },
    });
    console.log(`Published ${publishable.count} tagged question(s). The rest stay as drafts.`);
  }
}

main()
  .catch((e) => {
    console.error(`\nERROR: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
