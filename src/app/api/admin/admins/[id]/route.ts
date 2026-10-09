import { deleteAdminAccount } from "@/lib/admin/accounts";
import { adminRoute } from "@/lib/admin/route";

export const DELETE = adminRoute(async (admin, _req, params) => {
  const result = await deleteAdminAccount(params.id, admin);
  return Response.json({ ok: true, ...result });
});
