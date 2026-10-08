import pino from "pino";

// Structured JSON to stdout. Never log request bodies, answers, tokens or passwords;
// the redact list is a safety net, not a licence to log them.
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
