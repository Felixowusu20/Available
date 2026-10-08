import { switchToLearn } from "@/lib/practice/service";
import { userRoute } from "@/lib/practice/route";

export const POST = userRoute(async (user, _req, p) => {
  await switchToLearn(user.id, p.id);
  return Response.json({ ok: true });
});
