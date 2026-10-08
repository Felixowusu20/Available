/** Tiny dependency-free line chart of session scores (0-100%). */
export function TrendChart({ points }: { points: { pct: number; label: string }[] }) {
  if (points.length === 0) return <p className="text-sm text-muted">Finish a session to see your trend.</p>;
  const w = 320;
  const h = 90;
  const pad = 8;
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (points.length - 1));
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const summary = `Scores over your last ${points.length} sessions: ${points.map((p) => `${Math.round(p.pct)}%`).join(", ")}`;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" role="img" aria-label={summary} preserveAspectRatio="none">
        {[0, 50, 100].map((g) => (
          <line key={g} x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {points.length > 1 && <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.pct)} r="3" fill="var(--accent)">
            <title>{`${p.label}: ${Math.round(p.pct)}%`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted">
        <span>Older</span>
        <span>Latest: {Math.round(points[points.length - 1].pct)}%</span>
      </figcaption>
    </figure>
  );
}
