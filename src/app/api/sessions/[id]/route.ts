import { getState } from "@/lib/practice/service";
import { noStore, userRoute } from "@/lib/practice/route";

export const GET = userRoute(async (user, _req, p) => {
  return Response.json(await getState(user.id, p.id), { headers: noStore });
});
