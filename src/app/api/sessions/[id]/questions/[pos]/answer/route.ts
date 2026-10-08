import { answerSchema } from "@/lib/practice/schemas";
import { saveAnswer } from "@/lib/practice/service";
import { intParam, noStore, userRoute } from "@/lib/practice/route";
import { parseJson } from "@/lib/validation";

export const PUT = userRoute(async (user, req, p) => {
  const position = intParam(p.pos);
  if (position === null) return Response.json({ error: "Invalid position" }, { status: 400 });
  const parsed = await parseJson(req, answerSchema);
  if (!parsed.ok) return parsed.response;
  const result = await saveAnswer(user.id, p.id, position, parsed.data);
  return Response.json(result, { headers: noStore });
});
