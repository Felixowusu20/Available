import { aiEnabled } from "@/lib/env";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import questions" };

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Import questions</h1>
      <p className="text-sm text-muted">
        Upload a JSON or CSV file. Every row is checked and shown below before anything is saved. Imported questions always start as drafts.
      </p>
      <details className="card p-3 text-sm">
        <summary className="cursor-pointer font-medium">File format</summary>
        <div className="mt-2 space-y-2 text-muted">
          <p>
            <strong>JSON:</strong> an array of objects (or <code>{"{ \"questions\": [...] }"}</code>).
          </p>
          <pre className="overflow-x-auto rounded bg-bg p-2 text-xs">{`[{
  "stem": "Which nerve supplies the deltoid?",
  "options": ["Axillary", "Radial", "Ulnar", "Median"],
  "correct": "A",
  "explanation": "…",
  "discipline": "Anatomy", "subtopic": "Upper limb",   (optional)
  "difficulty": "easy", "source": "Past paper 2024"      (optional)
}]`}</pre>
          <p>
            <strong>CSV:</strong> header row with <code>stem</code>, either <code>options</code> (separated by <code>|</code>) or columns <code>A</code>–<code>D</code>, and{" "}
            <code>correct</code> (A–D or 1–4). Optional: <code>explanation</code>, <code>section</code>, <code>discipline</code>, <code>subtopic</code>, <code>difficulty</code>, <code>source</code>.
          </p>
          <p>Questions without valid tags are imported untagged; the AI tagger or you can tag them afterwards.</p>
        </div>
      </details>
      <ImportClient aiAvailable={aiEnabled()} />
    </main>
  );
}
