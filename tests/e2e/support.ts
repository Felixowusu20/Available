import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";

// These helpers talk to the test database directly (not through the app's own code), so the tests
// stay independent of how the app is built. The URL is set by playwright.config.ts.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

export const PASSWORD = "e2e-test-passphrase-123";
let n = 0;

/** A verified account created directly in the database (sign-up itself is covered by its own test). */
export async function createUser(role: "STUDENT" | "ADMIN" = "STUDENT") {
  const email = `e2e-${role.toLowerCase()}-${Date.now()}-${++n}@test.local`;
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "User" ("id","email","name","passwordHash","role","emailVerified","updatedAt") VALUES ($1,$2,$3,$4,$5::"Role",now(),now())`,
    [id, email, "E2E Person", await hash(PASSWORD), role],
  );
  return { id, email, password: PASSWORD };
}

/** Mints an email-verification token for an existing user, the same way the app does (only the hash is stored). */
export async function verificationTokenFor(email: string) {
  const { rows } = await pool.query(`SELECT "id" FROM "User" WHERE "email" = $1`, [email]);
  if (rows.length !== 1) throw new Error(`no such user: ${email}`);
  const raw = randomBytes(32).toString("base64url");
  await pool.query(`DELETE FROM "AuthToken" WHERE "userId" = $1 AND "type" = 'VERIFY_EMAIL' AND "usedAt" IS NULL`, [rows[0].id]);
  await pool.query(
    `INSERT INTO "AuthToken" ("id","userId","type","tokenHash","expiresAt") VALUES ($1,$2,'VERIFY_EMAIL',$3,now() + interval '1 day')`,
    [randomUUID(), rows[0].id, createHash("sha256").update(raw).digest("hex")],
  );
  return raw;
}

export async function closeDb() {
  await pool.end();
}

/**
 * The app's own error messages. Next.js also renders an empty role="alert" "route announcer" on
 * every page, so a bare getByRole("alert") is ambiguous.
 */
export const appAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

export async function logIn(page: Page, who: { email: string; password: string }, destination: RegExp = /\/dashboard/) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Password hashing is deliberately slow and a busy machine can stretch it, so allow a generous wait.
  await expect(page).toHaveURL(destination, { timeout: 30_000 });
}

/** Wait until the practice runner has hydrated, so keyboard shortcuts are live. */
export async function runnerReady(page: Page) {
  await expect(page.getByRole("group", { name: "Answer options" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

export async function finishFromRunner(page: Page) {
  await page.getByRole("button", { name: "Finish", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(/\/results\//);
}
