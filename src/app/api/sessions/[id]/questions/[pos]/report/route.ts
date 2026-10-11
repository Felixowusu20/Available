import { rateLimit } from "@/lib/rate-limit";
import { reportSchema } from "@/lib/report-reasons";
import { submitReport } from "@/lib/reports";
import { intParam, userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

export const PUT = userRoute(async (user, req, p) => {
  const position = intParam(p.pos);
  if (position === null) return Response.json({ error: "Invalid position" }, { status: 400 });
  const limited = await rateLimit(`report:${user.id}`, 30, 60 * 60);
  if (!limited.ok) {
    return Response.json({ error: "You've sent a lot of reports. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  const parsed = await parseJson(req, reportSchema);
  if (!parsed.ok) return parsed.response;
  await submitReport(user.id, p.id, position, parsed.data);
  return Response.json({ ok: true });
});
