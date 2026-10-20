import { startPremiumCheckout } from "@/lib/premium/checkout";
import { userRoute } from "@/lib/practice/route";

// Starts a payment. Returns the Paystack checkout address; the browser then goes there. No amount is accepted from the browser.
export const POST = userRoute(async (user) => {
  const { url } = await startPremiumCheckout(user);
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
});
