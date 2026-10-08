import { windowSchema } from "@/lib/practice/schemas";
import { getQuestions } from "@/lib/practice/service";
import { noStore, userRoute } from "@/lib/practice/route";

// A window of questions from ONE of the caller's own sessions (never the whole bank).
export const GET = userRoute(async (user, req, p) => {
  const url = new URL(req.url);
  const parsed = windowSchema.safeParse({ from: url.searchParams.get("from") ?? undefined, count: url.searchParams.get("count") ?? undefined });
  if (!parsed.success) return Response.json({ error: "Invalid window" }, { status: 400 });
  const questions = await getQuestions(user.id, p.id, parsed.data.from, parsed.data.count);
  return Response.json({ questions }, { headers: noStore });
});
