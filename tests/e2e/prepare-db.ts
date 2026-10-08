import { execSync } from "node:child_process";

// Brings the test database to a known state: migrated, empty, and holding a bank of published questions.
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_test\b/.test(url)) throw new Error("prepare-db refused: DATABASE_URL must point at a database whose name ends in _test");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  const { resetDb, seedBank } = await import("../integration/helpers");
  const { db } = await import("../../src/lib/db");
  await resetDb();
  await seedBank({ pre: 60, cli: 60 });
  await db.$disconnect();
  console.log("e2e database ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
