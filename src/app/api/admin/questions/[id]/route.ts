import { adminRoute } from "@/lib/admin/route";
import { deleteQuestion, getQuestion, updateQuestion } from "@/lib/admin/questions";
import { questionInputSchema } from "@/lib/question-schema";
import { parseJson } from "@/lib/validation";

export const GET = adminRoute(async (_admin, _req, p) => {
  return Response.json(await getQuestion(p.id), { headers: { "Cache-Control": "no-store" } });
});

export const PUT = adminRoute(async (admin, req, p) => {
  const parsed = await parseJson(req, questionInputSchema);
  if (!parsed.ok) return parsed.response;
  await updateQuestion(admin.id, p.id, parsed.data);
  return Response.json({ ok: true });
});

export const DELETE = adminRoute(async (_admin, _req, p) => {
  await deleteQuestion(p.id);
  return Response.json({ ok: true });
});
