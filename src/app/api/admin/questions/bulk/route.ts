import { adminRoute } from "@/lib/admin/route";
import { bulkSchema, bulkSetPriority, bulkSetStatus } from "@/lib/admin/questions";
import { parseJson } from "@/lib/validation";

export const POST = adminRoute(async (admin, req) => {
  const parsed = await parseJson(req, bulkSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if ("highPriority" in body) return Response.json(await bulkSetPriority(body.ids, body.highPriority));
  return Response.json(await bulkSetStatus(admin.id, body.ids, body.status));
});
