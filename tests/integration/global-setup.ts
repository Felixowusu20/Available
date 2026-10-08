import { execSync } from "node:child_process";

// Applies every migration to the test database before any test runs, exactly as a deploy would.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://mdc:mdc@localhost:5432/mdc_test?schema=public";
  if (!/_test\b/.test(url)) {
    throw new Error(`Refusing to run integration tests against "${url.replace(/:[^:@/]*@/, ":***@")}": the database name must end in _test.`);
  }
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
