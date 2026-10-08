// Browser-side helper (no server imports). Sends selections to the AI run endpoint in chunks so each
// HTTP request stays short, and keeps going when one chunk fails.
const CHUNK = 25;

export type RunProgress = { done: number; total: number };
export type RunTotals = { succeeded: number; failed: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; errors: string[] };

export async function runAiInChunks(kind: "tag" | "quality", ids: string[], onProgress?: (p: RunProgress) => void): Promise<RunTotals> {
  const totals: RunTotals = { succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, errors: [] };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    onProgress?.({ done: i, total: ids.length });
    try {
      const res = await fetch("/api/admin/ai/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ids: chunk }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A rejected key, a missing key or a rate limit will not fix itself on the next chunk: stop.
        totals.failed += ids.length - i;
        totals.errors.push(data?.error ?? `Request failed (${res.status})`);
        break;
      }
      totals.succeeded += data.succeeded;
      totals.failed += data.failed;
      totals.inputTokens += data.tokens?.input ?? 0;
      totals.outputTokens += data.tokens?.output ?? 0;
      totals.estimatedCostUsd = totals.estimatedCostUsd === null || data.estimatedCostUsd === null ? null : totals.estimatedCostUsd + data.estimatedCostUsd;
      totals.errors.push(...(data.errors ?? []));
    } catch {
      totals.failed += chunk.length;
      totals.errors.push("Network problem while contacting the server.");
      break;
    }
  }
  onProgress?.({ done: ids.length, total: ids.length });
  totals.errors = [...new Set(totals.errors)].slice(0, 3);
  return totals;
}

export function describeTotals(t: RunTotals): string {
  const cost = t.estimatedCostUsd === null ? "" : `, about $${t.estimatedCostUsd.toFixed(3)}`;
  const base = `AI run finished: ${t.succeeded} suggestion${t.succeeded === 1 ? "" : "s"} ready, ${t.failed} failed (${t.inputTokens.toLocaleString("en-GB")} tokens in, ${t.outputTokens.toLocaleString("en-GB")} out${cost}).`;
  return t.errors.length ? `${base} ${t.errors.join(" ")}` : base;
}
