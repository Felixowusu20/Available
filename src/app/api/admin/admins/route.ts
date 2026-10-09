import { adminAccountSchema, createAdminAccount } from "@/lib/admin/accounts";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/guards";
import { ServiceError, handle } from "@/lib/practice/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await getCurrentUser();
    const admins = await db.user.count({ where: { role: "ADMIN" } });
    if (admins > 0 && actor?.role !== "ADMIN") {
      throw new ServiceError(actor ? 403 : 401, actor ? "Forbidden" : "Unauthorised");
    }
    if (admins === 0) {
      const limited = await rateLimit(`admin-setup:ip:${clientIp(req.headers)}`, 5, 60 * 60);
      if (!limited.ok) throw new ServiceError(429, "Too many attempts. Try again later.");
    }
    const body = await req.json().catch(() => null);
    const parsed = adminAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceError(400, parsed.error.issues.map((i) => i.message).join(" ") || "Check the name, email and password.");
    }
    const user = await createAdminAccount(parsed.data, actor?.role === "ADMIN" ? actor : null);
    return Response.json({ ok: true, email: user.email, first: admins === 0 });
  });
}
