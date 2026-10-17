import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests talk to a REAL PostgreSQL database, never the development one.
// Start Postgres (docker compose -f docker-compose.dev.yml up -d) and run `npm run test:integration`.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://mdc:mdc@localhost:5432/mdc_test?schema=public";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    // One shared database, so test files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_POOL_MAX: "5",
      AUTH_SECRET: "integration-test-secret-0123456789abcdef",
      APP_URL: "http://localhost:3000",
      ANTHROPIC_API_KEY: "", // the AI-unavailable path is part of what is tested
      AI_TAGGING_MODEL: "claude-haiku-5-5",
      AI_QUALITY_MODEL: "claude-sonnet-5-5",
      AI_QUALITY_EFFORT: "medium",
      PAYSTACK_SECRET_KEY: "sk_test_integration_secret_0123456789",
      PREMIUM_PRICE_PESEWAS: "1000",
      LOG_LEVEL: "silent",
    },
  },
});
