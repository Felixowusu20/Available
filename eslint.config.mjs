import next from "eslint-config-next";

const config = [
  ...next,
  {
    // Generated or third-party output: never lint it.
    ignores: ["src/generated/**", ".next/**", ".next-e2e/**", "node_modules/**", "playwright-report/**", "test-results/**", "coverage/**", "tests/e2e/**"],
  },
];

export default config;
