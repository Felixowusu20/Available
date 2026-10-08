"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** One-click learn-mode practice on a single discipline or subtopic (used from the dashboard). */
export function PracticeTopicButton({ discipline, subtopic }: { discipline: string; subtopic: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function go() {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "TOPIC",
          mode: "LEARN",
          count: 20,
          disciplines: subtopic ? [] : [discipline],
          subtopics: subtopic ? [{ discipline, subtopic }] : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      router.push(`/practice/${data.id}`);
    } catch {
      setErr(true);
      setBusy(false);
    }
  }

  return (
    <button onClick={go} disabled={busy} className="btn btn-ghost !min-h-9 !px-3 !py-1 text-sm">
      {busy ? "Starting…" : err ? "Retry" : "Practise"}
    </button>
  );
}
