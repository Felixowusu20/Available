import { taxonomy } from "@/lib/taxonomy";
import { emptyQuestion, QuestionForm } from "../question-form";

export const metadata = { title: "New question" };

export default function NewQuestionPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">New question</h1>
      <QuestionForm initial={emptyQuestion} tree={taxonomy} />
    </main>
  );
}
