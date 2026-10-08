import pino from "pino";

// Structured JSON to stdout. Never log request bodies, answers, tokens or passwords;
// the redact list is a safety net, not a licence to log them.
/**
 * Log-safe view of an error. Never log `err.message` for database errors: Prisma validation errors
 * can embed the arguments of the failed call (a password hash, a student's answer). The reason Prisma
 * actually failed is on the last line, so keep just that.
 */
export function safeError(err: unknown): { name: string; code?: string; reason: string } {
  const e = err instanceof Error ? err : new Error(String(err));
  const code = (e as { code?: unknown }).code;
  const reason = e.message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  return { name: e.name, ...(typeof code === "string" && { code }), reason: (reason ?? "").slice(0, 200) };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "mdc-practice" },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "*.password",
      "*.passwordHash",
      "*.token",
      "headers.authorization",
      "headers.cookie",
      "apiKey",
    ],
    censor: "[redacted]",
  },
});
