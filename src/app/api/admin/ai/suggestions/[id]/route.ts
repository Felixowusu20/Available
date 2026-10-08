import { adminRoute } from "@/lib/admin/route";
import { resolveSchema, resolveSuggestion } from "@/lib/ai/suggestions";
import { parseJson } from "@/lib/validation";

export const POST = adminRoute(async (admin, req, p) => {
  const parsed = await parseJson(req, resolveSchema);
  if (!parsed.ok) return parsed.response;
  await resolveSuggestion(admin.id, p.id, parsed.data);
  return Response.json({ ok: true });
});
