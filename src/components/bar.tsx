/** Accuracy bar made of two divs; no chart library. Colour shifts with the value. */
export function Bar({ pct, label }: { pct: number; label?: string }) {
  const tone = pct >= 70 ? "bg-ok" : pct >= 50 ? "bg-warn" : "bg-bad";
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-line"
      role="img"
      aria-label={label ?? `${Math.round(pct)} percent`}
    >
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
