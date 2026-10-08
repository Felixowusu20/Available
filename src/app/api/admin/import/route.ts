import { z } from "zod";
import { adminRoute } from "@/lib/admin/route";
import { parseImport } from "@/lib/admin/import";
import { commitRows, previewRows } from "@/lib/admin/import-service";
import { parseJson } from "@/lib/validation";

const bodySchema = z.object({
  mode: z.enum(["preview", "commit"]),
  format: z.enum(["json", "csv"]),
  text: z.string().max(6 * 1024 * 1024),
  filename: z.string().max(200).optional(),
  skipSimilar: z.boolean().default(false),
});

// One endpoint, two modes. Commit re-parses and re-validates the raw text on the server, so the
// preview the browser saw can never be used to smuggle in unvalidated rows.
export const POST = adminRoute(async (admin, req) => {
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { mode, format, text, filename, skipSimilar } = parsed.data;

  const { rows, fatal } = parseImport(text, format);
  if (fatal) return Response.json({ error: fatal }, { status: 400 });

  if (mode === "preview") return Response.json(await previewRows(rows));

  const result = await commitRows(admin.id, rows, { skipSimilar, defaultSource: filename ? `import:${filename}` : "import" });
  return Response.json(result, { status: 201 });
});
