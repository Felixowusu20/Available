import { createHash, randomBytes } from "node:crypto";
import type { AuthTokenType } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const TTL_MS: Record<AuthTokenType, number> = {
  VERIFY_EMAIL: 24 * 60 * 60 * 1000,
  RESET_PASSWORD: 60 * 60 * 1000,
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Creates a one-time token, invalidating earlier unused ones of the same type. Returns the raw token. */
export async function issueToken(userId: string, type: AuthTokenType): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
    db.authToken.create({
      data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL_MS[type]) },
    }),
  ]);
  return raw;
}

/**
 * Atomically consumes a token. Returns the user id, or null if unknown, expired or already used.
 */
export async function consumeToken(raw: string, type: AuthTokenType): Promise<string | null> {
  const res = await db.authToken.updateMany({
    where: { tokenHash: sha256(raw), type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (res.count !== 1) return null;
  const row = await db.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
  return row?.userId ?? null;
}
