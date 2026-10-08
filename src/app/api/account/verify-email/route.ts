import { db } from "@/lib/db";
import { consumeToken } from "@/lib/auth-tokens";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseJson, verifySchema } from "@/lib/validation";

// POST (not GET) so email scanners that pre-fetch links cannot consume the token.
export async function POST(req: Request) {
  const limited = await rateLimit(`verify:ip:${clientIp(req.headers)}`, 20, 15 * 60);
  if (!limited.ok) return Response.json({ error: "Too many attempts" }, { status: 429 });

  const parsed = await parseJson(req, verifySchema);
  if (!parsed.ok) return parsed.response;

  const userId = await consumeToken(parsed.data.token, "VERIFY_EMAIL");
  if (!userId) return Response.json({ error: "This link is invalid or has expired." }, { status: 400 });

  await db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  return Response.json({ ok: true });
}
