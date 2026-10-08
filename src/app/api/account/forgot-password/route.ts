import { db } from "@/lib/db";
import { issueToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { forgotSchema, parseJson } from "@/lib/validation";

export async function POST(req: Request) {
  const ip = await rateLimit(`forgot:ip:${clientIp(req.headers)}`, 10, 60 * 60);
  if (!ip.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  const parsed = await parseJson(req, forgotSchema);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;

  const perEmail = await rateLimit(`forgot:email:${email}`, 3, 60 * 60);
  if (perEmail.ok) {
    const user = await db.user.findUnique({ where: { email } });
    if (user) await sendPasswordResetEmail(email, await issueToken(user.id, "RESET_PASSWORD"));
  }
  // Always the same answer, so the form cannot be used to probe for accounts.
  return Response.json({ ok: true });
}
