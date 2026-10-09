import "dotenv/config";
import { readdirSync } from "node:fs";
import path from "node:path";
import { verify } from "@node-rs/argon2";
import { db } from "../src/lib/db";

// Diagnoses "I can't sign in" on a deployment by inspecting its DATABASE. Read-only unless you pass
// --clear-login-limits. It never prints passwords, hashes, tokens or the connection password.
//
//   # PowerShell (note: the URL is typed here, not read from .env, so you check the PRODUCTION database)
//   $env:DATABASE_URL = "<production connection string>"
//   npx tsx scripts/check-deployment.ts
//   npx tsx scripts/check-deployment.ts --email you@example.com
//   $env:CHECK_PASSWORD = "<the password you are trying>"; npx tsx scripts/check-deployment.ts --email you@example.com
//   npx tsx scripts/check-deployment.ts --email you@example.com --clear-login-limits
//
// A DATABASE_URL pointing at localhost is refused unless you add --allow-local, because the usual
// mistake is seeding the admin into the LOCAL database while the site uses a different one.

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

let failures = 0;
const line = (kind: "PASS" | "FAIL" | "WARN" | "INFO", msg: string, hint?: string) => {
  if (kind === "FAIL") failures++;
  console.log(`${kind}  ${msg}`);
  if (hint) console.log(`      → ${hint}`);
};

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set. Set it to the PRODUCTION connection string in this shell first.");
  const url = new URL(raw);
  const isLocal = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(url.hostname);
  console.log(`Checking database "${url.pathname.slice(1)}" on host ${url.hostname} (credentials not shown)\n`);
  if (isLocal && !flag("--allow-local")) {
    line("FAIL", "DATABASE_URL points at this computer, not at your hosted database", "This is the most common cause: the admin was created in the LOCAL database. Set DATABASE_URL to the hosted one, or add --allow-local to check local on purpose.");
    return;
  }

  // 1. connection
  try {
    await db.$queryRaw`SELECT 1`;
    line("PASS", "connected to the database");
  } catch {
    line("FAIL", "could not connect to the database", "Check the connection string, that the database allows connections from your IP, and sslmode=require if your provider needs TLS.");
    return;
  }

  // 2. migrations
  const expected = readdirSync(path.resolve("prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  let applied: string[] = [];
  try {
    const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM _prisma_migrations`;
    applied = rows.filter((r) => r.finished_at).map((r) => r.migration_name);
  } catch {
    line("FAIL", "no migration history: the database has no tables yet", "Run: npx prisma migrate deploy   (with DATABASE_URL set to this database). Until then every sign-in attempt fails with 'We couldn't sign you in right now'.");
    return;
  }
  const missing = expected.filter((m) => !applied.includes(m));
  if (missing.length) line("FAIL", `${missing.length} migration(s) not applied: ${missing.join(", ")}`, "Run: npx prisma migrate deploy");
  else line("PASS", `all ${expected.length} migrations applied`);

  // 3. extension
  const ext = await db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
  if (ext.length) line("PASS", "pg_trgm extension present");
  else line("WARN", "pg_trgm extension is missing (near-duplicate detection will fail)", "Run once as the database owner: CREATE EXTENSION pg_trgm;");

  // 4. users
  const [users, admins] = await Promise.all([db.user.count(), db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, emailVerified: true, passwordHash: true, lastLoginAt: true, createdAt: true } })]);
  line("INFO", `${users} user(s) in total, ${admins.length} admin(s)`);
  if (admins.length === 0) {
    line("FAIL", "there is NO admin account in this database", "Create it: ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npm run db:seed:admin   (with DATABASE_URL set to this database, password at least 10 characters).");
  }
  for (const a of admins) {
    line("INFO", `admin ${a.email}: ${a.emailVerified ? "email verified" : "NOT verified"}, ${a.passwordHash ? "has a password" : "NO password set"}, created ${a.createdAt.toISOString().slice(0, 10)}, last login ${a.lastLoginAt ? a.lastLoginAt.toISOString().slice(0, 16) : "never"}`);
  }

  // 5. the specific account being tried
  const email = value("--email")?.trim().toLowerCase();
  if (email) {
    const u = await db.user.findUnique({ where: { email } });
    if (!u) {
      line("FAIL", `no account with the email "${email}"`, "Emails are stored lower-case with no spaces. Check for a typo, or the admin was created under a different address (see the admin list above).");
    } else {
      line("PASS", `account ${email} exists (role ${u.role})`);
      if (!u.emailVerified) line("FAIL", "its email is not verified", "Sign-in is refused until verified. Re-run db:seed:admin (it verifies the admin) or verify via the emailed link.");
      if (!u.passwordHash) line("FAIL", "it has no password", "Re-run db:seed:admin to set one.");
      const pw = process.env.CHECK_PASSWORD;
      if (pw && u.passwordHash) {
        const ok = await verify(u.passwordHash, pw).catch(() => false);
        if (ok) line("PASS", "the password you provided MATCHES this account");
        else line("FAIL", "the password you provided does NOT match this account", "Reset it by re-running db:seed:admin with the password you want (min 10 characters), or use Forgot password.");
      } else if (!pw) {
        line("INFO", "to test a password without typing it into the site, set CHECK_PASSWORD in this shell and run again");
      }
    }

    // 6. lockout (8 failed attempts per email per 15 minutes)
    const windowMs = 15 * 60 * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const lock = await db.rateLimit.findUnique({ where: { key_windowStart: { key: `login:email:${email}`, windowStart } } });
    if (lock && lock.count >= 8) {
      line("FAIL", `this email is locked out right now (${lock.count} failed attempts in this 15-minute window)`, "Wait for the window to end, or clear it: add --clear-login-limits");
    } else {
      line("PASS", `no login lockout in effect (${lock?.count ?? 0} failed attempts this window)`);
    }
  }

  if (flag("--clear-login-limits")) {
    const res = await db.rateLimit.deleteMany({ where: { key: { startsWith: "login:" } } });
    line("INFO", `cleared ${res.count} login rate-limit record(s)`);
  }

  // 7. content
  const q = await db.question.groupBy({ by: ["status", "section"], _count: true });
  const published = q.filter((r) => r.status === "PUBLISHED");
  const pre = published.find((r) => r.section === "PRECLINICAL")?._count ?? 0;
  const cli = published.find((r) => r.section === "CLINICAL")?._count ?? 0;
  if (pre + cli === 0) line("WARN", "no published questions yet: students cannot start a practice session", "Load them: npm run db:seed   (with DATABASE_URL set to this database).");
  else line("PASS", `published questions: ${pre} preclinical, ${cli} clinical`);
}

main()
  .catch((e) => {
    console.error(`\nERROR: ${e instanceof Error ? e.message : e}`);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(failures ? `\n${failures} problem(s) found.` : "\nNo problems found in the database.");
    process.exitCode = failures ? 1 : 0;
  });
