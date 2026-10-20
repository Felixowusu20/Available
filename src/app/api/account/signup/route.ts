import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { issueToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/email";
import { logger, safeError } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseJson, signUpSchema } from "@/lib/validation";

const generic = () => Response.json({ ok: true });
const mailFailed = () =>
  Response.json({ error: "We could not send the verification email. Wait a minute and try Create account again." }, { status: 502 });

async function sendVerification(userId: string, email: string) {
  const token = await issueToken(userId, "VERIFY_EMAIL");
  await sendVerificationEmail(email, token);
}

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

  // Same success response whether or not the email is already registered, so sign-up cannot be
  // used to discover which emails have accounts. An unverified account gets a fresh link, because
  // trying again is how students recover a message that never arrived.
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
  if (existing) {
    if (!existing.emailVerified) {
      try {
        await sendVerification(existing.id, email);
      } catch (err) {
        logger.error({ err: safeError(err) }, "signup resend failed");
        return mailFailed();
      }
    }
    return generic();
  }

  try {
    const user = await db.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
    });
    await sendVerification(user.id, email);
    logger.info({ userId: user.id }, "signup");
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return generic();
    logger.error({ err: safeError(err) }, "signup failed");
    return mailFailed();
  }
  return generic();
}
