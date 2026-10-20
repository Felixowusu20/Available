import { z } from "zod";
import { revokePremium } from "@/lib/premium/admin";
import { userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

const body = z.object({ userId: z.string().min(1).max(60) });

export const POST = userRoute(
  async (admin, req) => {
    const parsed = await parseJson(req, body);
    if (!parsed.ok) return parsed.response;
    await revokePremium(admin.id, parsed.data.userId);
    return Response.json({ ok: true });
  },
  { admin: true },
);
