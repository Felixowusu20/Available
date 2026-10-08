import { db } from "@/lib/db";
import { issueToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseJson, signUpSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const limited = await rateLimit(`signup:ip:${clientIp(req.headers)}`, 5, 60 * 60);
  if (!limited.ok) {
    return Response.json(
      { error: "Too many sign-up attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const parsed = await parseJson(req, signUpSchema);
  if (!parsed.ok) return parsed.response;
  const { name, email, password } = parsed.data;

  // Same response whether or not the email is already registered, so sign-up cannot be
  // used to discover which emails have accounts.
  const generic = Response.json({ ok: true });

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return generic;

  try {
    const user = await db.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
    });
    const token = await issueToken(user.id, "VERIFY_EMAIL");
    await sendVerificationEmail(email, token);
    logger.info({ userId: user.id }, "signup");
  } catch (err) {
    // A concurrent duplicate sign-up lands here; anything else is logged and hidden from the client.
    logger.error({ err: (err as Error).message }, "signup failed");
  }
  return generic;
}
