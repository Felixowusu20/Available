import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["src/generated/**", ".next/**", "node_modules/**", "tests/e2e/**"] },
];

export default config;
