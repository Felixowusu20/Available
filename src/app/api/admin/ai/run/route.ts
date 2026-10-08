import { z } from "zod";
import { adminRoute } from "@/lib/admin/route";
import { MAX_IDS_PER_RUN, runAi } from "@/lib/ai/pipeline";
import { aiEnabled } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { parseJson } from "@/lib/validation";

export const maxDuration = 300; // seconds, for platforms that cap request time

const bodySchema = z.object({
  kind: z.enum(["tag", "quality"]),
  ids: z.array(z.string().min(1).max(40)).min(1).max(MAX_IDS_PER_RUN),
});

export const POST = adminRoute(async (admin, req) => {
  if (!aiEnabled()) {
    return Response.json({ error: "AI features are unavailable: no ANTHROPIC_API_KEY is configured on the server." }, { status: 503 });
  }
  // Each run can spend real money, so cap how fast one admin can start them.
  const limited = await rateLimit(`ai-run:${admin.id}`, 40, 60 * 60);
  if (!limited.ok) {
    return Response.json({ error: "Too many AI runs this hour. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const summary = await runAi({ kind: parsed.data.kind === "tag" ? "TAG" : "QUALITY", ids: parsed.data.ids, adminId: admin.id });
  return Response.json(summary);
});
