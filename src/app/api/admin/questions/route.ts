import { adminRoute } from "@/lib/admin/route";
import { createQuestion } from "@/lib/admin/questions";
import { questionInputSchema } from "@/lib/question-schema";
import { parseJson } from "@/lib/validation";

export const POST = adminRoute(async (admin, req) => {
  const parsed = await parseJson(req, questionInputSchema);
  if (!parsed.ok) return parsed.response;
  const created = await createQuestion(admin.id, parsed.data);
  return Response.json(created, { status: 201 });
});
