import { grantPremium, grantSchema } from "@/lib/premium/admin";
import { userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

export const POST = userRoute(
  async (admin, req) => {
    const parsed = await parseJson(req, grantSchema);
    if (!parsed.ok) return parsed.response;
    await grantPremium(admin.id, parsed.data.email);
    return Response.json({ ok: true }, { status: 201 });
  },
  { admin: true },
);
