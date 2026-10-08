import Link from "next/link";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { db } from "@/lib/db";
import { aiEnabled, env } from "@/lib/env";
import { taxonomy } from "@/lib/taxonomy";
import { SuggestionCard, type SuggestionView } from "./suggestion-card";

export const metadata = { title: "AI review" };
export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("en-GB");

export default async function AiReviewPage() {
  const [pending, pendingTotal, runs] = await Promise.all([
    db.aiSuggestion.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        question: { select: { id: true, stem: true, explanation: true, status: true, section: true, discipline: true, subtopic: true } },
        run: { select: { kind: true, model: true } },
      },
    }),
    db.aiSuggestion.count({ where: { status: "PENDING" } }),
    db.aiRun.findMany({ orderBy: { startedAt: "desc" }, take: 15, include: { requestedBy: { select: { email: true } } } }),
  ]);

  // Resolve near-duplicate ids to short previews in one query.
  const dupIds = [...new Set(pending.flatMap((s) => ((s.duplicates ?? []) as { questionId: string }[]).map((d) => d.questionId)))];
  const dupQuestions = dupIds.length ? await db.question.findMany({ where: { id: { in: dupIds } }, select: { id: true, stem: true } }) : [];
  const dupStem = new Map(dupQuestions.map((q) => [q.id, q.stem]));

  const views: SuggestionView[] = pending.map((s) => ({
    id: s.id,
    kind: s.suggestedSection ? "TAG" : "QUALITY",
    model: s.run.model,
    question: s.question,
    suggested: s.suggestedSection ? { section: s.suggestedSection, discipline: s.suggestedDiscipline!, subtopic: s.suggestedSubtopic!, difficulty: s.suggestedDifficulty } : null,
    confidence: s.confidence,
    flags: (s.flags ?? []) as { code: string; note: string }[],
    draftedExplanation: s.draftedExplanation,
    duplicates: ((s.duplicates ?? []) as { questionId: string; similarity: number }[]).map((d) => ({ ...d, preview: (dupStem.get(d.questionId) ?? "").slice(0, 100) })),
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">AI review</h1>
        <p className="text-sm text-muted">
          Suggestions are never applied automatically. Accept, edit or reject each one; publishing a question is always a separate step.
        </p>
      </div>

      {!aiEnabled() && (
        <p role="note" className="rounded-lg bg-warn-bg p-3 text-sm text-warn">
          AI is unavailable: <code>ANTHROPIC_API_KEY</code> is not set on the server. Existing suggestions can still be reviewed.
        </p>
      )}
      <p className="text-xs text-muted">
        Tagging model <code>{env().AI_TAGGING_MODEL}</code> · quality model <code>{env().AI_QUALITY_MODEL}</code> (effort {env().AI_QUALITY_EFFORT}). Select questions on the{" "}
        <Link className="underline" href="/admin/questions">
          Questions
        </Link>{" "}
        page to run them.
      </p>

      <section aria-label="Pending suggestions" className="space-y-3">
        <h2 className="text-lg font-semibold">
          Pending ({pendingTotal}
          {pendingTotal > views.length ? `, showing ${views.length}` : ""})
        </h2>
        {views.length === 0 && <p className="text-muted">Nothing waiting for review.</p>}
        {views.map((v) => (
          <SuggestionCard key={v.id} s={v} tree={taxonomy} />
        ))}
      </section>

      <section aria-label="Recent AI runs" className="card overflow-x-auto p-4">
        <h2 className="mb-2 text-lg font-semibold">Recent runs and cost</h2>
        {runs.length === 0 && <p className="text-sm text-muted">No runs yet.</p>}
        {runs.length > 0 && (
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-2">When</th>
                <th className="pr-2">Type</th>
                <th className="pr-2">Model</th>
                <th className="pr-2">OK / failed</th>
                <th className="pr-2">Tokens in / out (cached)</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => {
                const cost = estimateCostUsd(r.model, { input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheReadTokens });
                return (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-2">{r.startedAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="pr-2">{r.kind === "TAG" ? "Tagging" : "Quality"}</td>
                    <td className="pr-2 font-mono text-xs">{r.model}</td>
                    <td className="pr-2">
                      {r.succeeded} / {r.failed}
                    </td>
                    <td className="pr-2">
                      {num(r.inputTokens)} / {num(r.outputTokens)} ({num(r.cacheReadTokens)})
                    </td>
                    <td>{cost === null ? "n/a" : `$${cost.toFixed(4)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">Cost is an estimate from list prices in <code>src/lib/ai/pricing.ts</code>; token counts are exact.</p>
      </section>
    </main>
  );
}
