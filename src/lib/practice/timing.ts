/** Extra time the server tolerates after the deadline, to absorb network delay on the final answer. */
export const GRACE_MS = 15_000;

export function timeLimitSeconds(questionCount: number, secondsPerQuestion: number): number {
  return questionCount * secondsPerQuestion;
}

export function deadlineOf(startedAt: Date, limitSeconds: number | null): Date | null {
  return limitSeconds == null ? null : new Date(startedAt.getTime() + limitSeconds * 1000);
}

export function isExpired(startedAt: Date, limitSeconds: number | null, now = Date.now()): boolean {
  const d = deadlineOf(startedAt, limitSeconds);
  return d != null && now > d.getTime();
}

/** True when a late write should still be refused (beyond deadline + grace). */
export function isPastGrace(startedAt: Date, limitSeconds: number | null, now = Date.now()): boolean {
  const d = deadlineOf(startedAt, limitSeconds);
  return d != null && now > d.getTime() + GRACE_MS;
}
