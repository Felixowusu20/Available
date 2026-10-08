import { adminRoute } from "@/lib/admin/route";
import { bulkSchema, bulkSetStatus } from "@/lib/admin/questions";
import { parseJson } from "@/lib/validation";

export const POST = adminRoute(async (admin, req) => {
  const parsed = await parseJson(req, bulkSchema);
  if (!parsed.ok) return parsed.response;
  return Response.json(await bulkSetStatus(admin.id, parsed.data.ids, parsed.data.status));
});
