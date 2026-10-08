import { rateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/practice/service";
import { createSessionSchema } from "@/lib/practice/schemas";
import { userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

export const POST = userRoute(async (user, req) => {
  const limited = await rateLimit(`session-create:${user.id}`, 40, 60 * 60);
  if (!limited.ok) {
    return Response.json({ error: "You're starting sessions too quickly. Try again shortly." }, { status: 429 });
  }
  const parsed = await parseJson(req, createSessionSchema);
  if (!parsed.ok) return parsed.response;
  const id = await createSession(user.id, parsed.data);
  return Response.json({ id }, { status: 201 });
});
