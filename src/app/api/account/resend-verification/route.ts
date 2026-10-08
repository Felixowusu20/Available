import { db } from "@/lib/db";
import { issueToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseJson, resendSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const ip = await rateLimit(`resend:ip:${clientIp(req.headers)}`, 10, 60 * 60);
  if (!ip.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  const parsed = await parseJson(req, resendSchema);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;

  const perEmail = await rateLimit(`resend:email:${email}`, 3, 60 * 60);
  if (perEmail.ok) {
    const user = await db.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      await sendVerificationEmail(email, await issueToken(user.id, "VERIFY_EMAIL"));
    }
  }
  return Response.json({ ok: true });
}
