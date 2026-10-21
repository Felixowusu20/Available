import { settleOwnPayment } from "@/lib/premium/settle";
import { noStore, userRoute } from "@/lib/practice/route";

// What the waiting screen asks. Each call checks with Paystack and opens premium when the money has been taken.
export const GET = userRoute(async (user, req) => {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  const state = await settleOwnPayment(user.id, reference);
  return Response.json({ state }, { headers: noStore });
});
