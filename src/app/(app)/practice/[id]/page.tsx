import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/guards";
import { ServiceError } from "@/lib/practice/http";
import { getQuestions, getState } from "@/lib/practice/service";
import { Runner } from "./runner";

export const metadata = { title: "Practice session" };
const WINDOW = 10;

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let state;
  try {
    state = await getState(user.id, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  if (state.finished) redirect(`/results/${id}`);

  // Resume at the first unanswered question (or the start).
  const firstOpen = state.map.findIndex((m) => !m.answered);
  const startAt = firstOpen === -1 ? 0 : firstOpen;
  const initialQuestions = await getQuestions(user.id, id, Math.floor(startAt / WINDOW) * WINDOW, WINDOW);

  return <Runner initialState={state} initialQuestions={initialQuestions} startAt={startAt} />;
}
