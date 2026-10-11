import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { findSimilarTo } from "@/lib/duplicates";
import { ServiceError } from "@/lib/practice/http";
import { questionInputSchema, STATUS_VALUES, type QuestionInput } from "@/lib/question-schema";
import { derivedFields } from "@/lib/question-store";
import { z } from "zod";

export const PAGE_SIZE = 25;

export const listFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  section: z.enum(["PRECLINICAL", "CLINICAL"]).optional(),
  discipline: z.string().max(100).optional(),
  subtopic: z.string().max(100).optional(),
  untagged: z.literal("1").optional(),
  flagged: z.literal("1").optional(),
  reported: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;

export async function listQuestions(f: ListFilters) {
  const where: Prisma.QuestionWhereInput = {
    ...(f.status && { status: f.status }),
    ...(f.section && { section: f.section }),
    ...(f.discipline && { discipline: f.discipline }),
    ...(f.subtopic && { subtopic: f.subtopic }),
    ...(f.untagged && { section: null }),
    ...(f.flagged && { suggestions: { some: { status: "PENDING" } } }),
    ...(f.reported && { reports: { some: { status: "OPEN" } } }),
    ...(f.q && { OR: [{ stem: { contains: f.q, mode: "insensitive" } }, { explanation: { contains: f.q, mode: "insensitive" } }, { source: { contains: f.q, mode: "insensitive" } }] }),
  };
  const [total, items] = await Promise.all([
    db.question.count({ where }),
    db.question.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, stem: true, status: true, section: true, discipline: true, subtopic: true, difficulty: true, updatedAt: true,
        _count: { select: { suggestions: { where: { status: "PENDING" } }, reports: { where: { status: "OPEN" } } } },
      },
    }),
  ]);
  return { items, total, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function statusCounts() {
  const rows = await db.question.groupBy({ by: ["status"], _count: true });
  const counts = { DRAFT: 0, IN_REVIEW: 0, PUBLISHED: 0, RETIRED: 0 };
  for (const r of rows) counts[r.status] = r._count;
  const untagged = await db.question.count({ where: { section: null } });
  return { ...counts, untagged };
}

function dataFrom(input: QuestionInput) {
  return {
    stem: input.stem,
    options: input.options,
    correctIndex: input.correctIndex,
    explanation: input.explanation,
    section: input.section ?? null,
    discipline: input.discipline ?? null,
    subtopic: input.subtopic ?? null,
    difficulty: input.difficulty ?? null,
    source: input.source ?? null,
    status: input.status,
    ...derivedFields(input),
  };
}

function mapWriteError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ServiceError(409, "A question with the same stem already exists.");
  }
  throw e;
}

export async function createQuestion(adminId: string, input: QuestionInput) {
  try {
    return await db.question.create({
      data: {
        ...dataFrom(input),
        createdById: adminId,
        reviewedById: input.status === "PUBLISHED" ? adminId : null,
        publishedAt: input.status === "PUBLISHED" ? new Date() : null,
      },
      select: { id: true },
    });
  } catch (e) {
    mapWriteError(e);
  }
}

export async function getQuestion(id: string) {
  const q = await db.question.findUnique({
    where: { id },
    include: {
      createdBy: { select: { email: true } },
      reviewedBy: { select: { email: true } },
      suggestions: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { reports: { where: { status: "OPEN" } } } },
    },
  });
  if (!q) throw new ServiceError(404, "Question not found");
  const similar = await findSimilarTo(id);
  return { question: q, similar };
}

export async function updateQuestion(adminId: string, id: string, input: QuestionInput) {
  const existing = await db.question.findUnique({ where: { id }, select: { status: true, publishedAt: true } });
  if (!existing) throw new ServiceError(404, "Question not found");
  const becomingPublished = input.status === "PUBLISHED" && existing.status !== "PUBLISHED";
  try {
    await db.question.update({
      where: { id },
      data: {
        ...dataFrom(input),
        ...(becomingPublished && { reviewedById: adminId, publishedAt: new Date() }),
      },
    });
  } catch (e) {
    mapWriteError(e);
  }
}

export async function deleteQuestion(id: string) {
  const q = await db.question.findUnique({ where: { id }, select: { status: true, _count: { select: { sessionQuestions: true } } } });
  if (!q) throw new ServiceError(404, "Question not found");
  if (q._count.sessionQuestions > 0) throw new ServiceError(409, "Students have already seen this question. Retire it instead of deleting.");
  if (q.status === "PUBLISHED") throw new ServiceError(409, "Retire a published question before deleting it.");
  await db.question.delete({ where: { id } });
}

export const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
  status: z.enum(STATUS_VALUES),
});

/** Moves many questions to a status. Untagged ones cannot go to review/published; they are reported back. */
export async function bulkSetStatus(adminId: string, ids: string[], status: (typeof STATUS_VALUES)[number]) {
  const needsTags = status === "IN_REVIEW" || status === "PUBLISHED";
  const rows = await db.question.findMany({ where: { id: { in: ids } }, select: { id: true, section: true, discipline: true, subtopic: true, status: true } });
  const eligible = rows.filter((r) => r.status !== status && (!needsTags || (r.section && r.discipline && r.subtopic)));
  const skippedUntagged = needsTags ? rows.filter((r) => !(r.section && r.discipline && r.subtopic)).length : 0;
  const publishing = status === "PUBLISHED";
  const res = await db.question.updateMany({
    where: { id: { in: eligible.map((r) => r.id) } },
    data: { status, ...(publishing && { reviewedById: adminId, publishedAt: new Date() }) },
  });
  return { updated: res.count, skippedUntagged };
}
