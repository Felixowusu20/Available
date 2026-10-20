import { z } from "zod";
import { recheckPayment } from "@/lib/premium/admin";
import { userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

const body = z.object({ reference: z.string().trim().min(5).max(100) });

// Asks Paystack what happened to one payment and applies the answer. For a webhook that never arrived.
export const POST = userRoute(
  async (_admin, req) => {
    const parsed = await parseJson(req, body);
    if (!parsed.ok) return parsed.response;
    return Response.json({ outcome: await recheckPayment(parsed.data.reference) });
  },
  { admin: true },
);
