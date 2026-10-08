import { describe, expect, it } from "vitest";
import { safeError } from "./logger";

describe("safeError", () => {
  it("keeps the failure reason but drops the data Prisma echoes back in its message", () => {
    const err = Object.assign(
      new Error(
        [
          "Invalid `prisma.user.create()` invocation:",
          "",
          "{",
          "  data: {",
          '    email: "student@example.com",',
          '    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0c2FsdA$aGFzaGhhc2hoYXNo"',
          "  }",
          "}",
          "",
          "Unique constraint failed on the fields: (`email`)",
        ].join("\n"),
      ),
      { code: "P2002", name: "PrismaClientKnownRequestError" },
    );
    const out = safeError(err);
    expect(out).toEqual({ name: "PrismaClientKnownRequestError", code: "P2002", reason: "Unique constraint failed on the fields: (`email`)" });
    expect(JSON.stringify(out)).not.toMatch(/argon2|student@example/);
  });

  it("handles plain errors, non-errors and very long messages", () => {
    expect(safeError(new Error("boom"))).toEqual({ name: "Error", reason: "boom" });
    expect(safeError("just a string")).toMatchObject({ reason: "just a string" });
    expect(safeError(new Error("x".repeat(1000))).reason).toHaveLength(200);
  });
});
