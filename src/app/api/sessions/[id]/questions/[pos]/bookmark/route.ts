import { bookmarkSchema } from "@/lib/practice/schemas";
import { setBookmark } from "@/lib/practice/service";
import { intParam, userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

export const PUT = userRoute(async (user, req, p) => {
  const position = intParam(p.pos);
  if (position === null) return Response.json({ error: "Invalid position" }, { status: 400 });
  const parsed = await parseJson(req, bookmarkSchema);
  if (!parsed.ok) return parsed.response;
  await setBookmark(user.id, p.id, position, parsed.data.bookmarked);
  return Response.json({ ok: true });
});
