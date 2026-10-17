import { defineConfig } from "@playwright/test";

// End-to-end tests drive a real browser against a production build of the app and a disposable
// PostgreSQL database (mdc_test, never your development data).
//
//   docker compose -f docker-compose.dev.yml up -d     # Postgres, once
//   npx playwright install chromium                    # browser, once (or set PW_CHANNEL=chrome|msedge)
//   npm run test:e2e
const PORT = 3100;
export const E2E_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://mdc:mdc@localhost:5432/mdc_test?schema=public";
const BASE_URL = `http://localhost:${PORT}`;

// Workers are child processes of this one, so they inherit this and talk to the same database as the server.
process.env.DATABASE_URL = E2E_DATABASE_URL;

const channel = process.env.PW_CHANNEL || undefined; // "chrome" or "msedge" to use an installed browser

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, channel, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    // Prepare the database, build, and serve. Reused if something is already listening (not in CI).
    command: `npx tsx tests/e2e/prepare-db.ts && npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_SECRET: "e2e-secret-0123456789abcdefghijklmnop",
      AUTH_TRUST_HOST: "true",
      APP_URL: BASE_URL,
      REQUIRE_EMAIL_VERIFICATION: "true",
      EXAM_SECONDS_PER_QUESTION: "72",
      // A made-up test key: the Premium page switches on and the tests can sign webhooks. It never talks to Paystack.
      PAYSTACK_SECRET_KEY: "sk_test_e2e_secret_0123456789",
      PREMIUM_PRICE_PESEWAS: "1000",
      ANTHROPIC_API_KEY: "",
      LOG_LEVEL: "warn",
    },
  },
});
