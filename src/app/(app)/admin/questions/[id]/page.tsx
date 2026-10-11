import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuestion } from "@/lib/admin/questions";
import { ServiceError } from "@/lib/practice/http";
import { taxonomy } from "@/lib/taxonomy";
import { QuestionForm, type QuestionFormValues } from "../question-form";

export const metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await getQuestion(id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const { question: q, similar } = data;

  const initial: QuestionFormValues = {
    id: q.id,
    stem: q.stem,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    section: q.section ?? "",
    discipline: q.discipline ?? "",
    subtopic: q.subtopic ?? "",
    difficulty: q.difficulty ?? "",
    source: q.source ?? "",
    status: q.status,
    highPriority: q.highPriority,
  };

  const pending = q.suggestions.filter((s) => s.status === "PENDING");

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Edit question</h1>
        <Link href="/admin/questions" className="text-sm underline">
          Back to list
        </Link>
      </div>

      <p className="text-xs text-muted">
        Created {q.createdAt.toLocaleDateString("en-GB")} by {q.createdBy?.email ?? "seed/import"}
        {q.reviewedBy && ` · approved by ${q.reviewedBy.email}`}
        {q.legacyTopic && ` · original topic: ${q.legacyTopic}`}
      </p>

      {pending.length > 0 && (
        <p className="rounded-lg bg-accent/10 p-3 text-sm">
          This question has {pending.length} pending AI suggestion{pending.length === 1 ? "" : "s"}.{" "}
          <Link href="/admin/ai" className="underline">
            Review them
          </Link>
          .
        </p>
      )}

      {similar.length > 0 && (
        <div className="rounded-lg bg-warn-bg p-3 text-sm text-warn" role="note">
          Possible duplicates:
          <ul className="mt-1 list-disc pl-5">
            {similar.map((s) => (
              <li key={s.questionId}>
                <Link href={`/admin/questions/${s.questionId}`} className="underline">
                  {Math.round(s.similarity * 100)}% similar
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QuestionForm initial={initial} tree={taxonomy} />
    </main>
  );
}
