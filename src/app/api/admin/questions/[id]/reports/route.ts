import { adminRoute } from "@/lib/admin/route";
import { closeReports, closeReportsSchema } from "@/lib/reports";
import { parseJson } from "@/lib/validation";

/** Closes every open report on this question as fixed or as needing no change. */
export const POST = adminRoute(async (admin, req, p) => {
  const parsed = await parseJson(req, closeReportsSchema);
  if (!parsed.ok) return parsed.response;
  return Response.json(await closeReports(admin.id, p.id, parsed.data));
});
