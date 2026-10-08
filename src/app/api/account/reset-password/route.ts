import { db } from "@/lib/db";
import { consumeToken } from "@/lib/auth-tokens";
import { hashPassword } from "@/lib/password";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseJson, resetSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const limited = await rateLimit(`reset:ip:${clientIp(req.headers)}`, 10, 15 * 60);
  if (!limited.ok) return Response.json({ error: "Too many attempts" }, { status: 429 });

  const parsed = await parseJson(req, resetSchema);
  if (!parsed.ok) return parsed.response;

  const userId = await consumeToken(parsed.data.token, "RESET_PASSWORD");
  if (!userId) return Response.json({ error: "This link is invalid or has expired." }, { status: 400 });

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(parsed.data.password),
      // A reset link proves control of the mailbox, and bumping tokenVersion signs out every device.
      emailVerified: new Date(),
      tokenVersion: { increment: 1 },
    },
  });
  return Response.json({ ok: true });
}
