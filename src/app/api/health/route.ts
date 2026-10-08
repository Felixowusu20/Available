import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Uptime check: 200 when the app can reach the database, 503 otherwise. Exposes no details.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
