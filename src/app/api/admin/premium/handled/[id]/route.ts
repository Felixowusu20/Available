import { markProblemHandled } from "@/lib/premium/admin";
import { userRoute } from "@/lib/practice/route";

export const POST = userRoute(
  async (_admin, _req, p) => {
    await markProblemHandled(p.id);
    return Response.json({ ok: true });
  },
  { admin: true },
);
