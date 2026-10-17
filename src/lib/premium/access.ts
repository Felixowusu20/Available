import { db } from "@/lib/db";

// Premium is a one-time unlock (GHS 10, for life) of four things:
//   1. practising one section (preclinical or clinical) on its own,
//   2. the "questions left" counters on the practice screen,
//   3. unseen high-priority questions being drawn first.
// The fourth new feature, "report a question", stays FREE: every report helps improve the questions.
// ALL the checks live here and in service.ts's one call to `hasPremium`, so the rule is easy to find and to change.
//
// Premium is set only by a confirmed Paystack payment (premium/confirm.ts) or by an admin (premium/admin.ts).
// Admins can use every feature without being premium themselves.

export const PREMIUM_FEATURES = [
  { title: "Practise one section", text: "Only preclinical or only clinical, for example 50 preclinical questions." },
  { title: "Questions left", text: "See how many questions you have not answered yet in every discipline and topic." },
  { title: "Priority questions first", text: "The questions the examiners are most likely to ask come to you first." },
  { title: "Report a question", text: "Free for everyone. Tell us about a wrong answer or a typo." },
] as const;

/** Does this person get the premium features? Admin accounts always do. */
export async function hasPremium(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, premiumAt: true } });
  return !!u && (u.role === "ADMIN" || u.premiumAt !== null);
}

/**
 * High-priority questions are drawn first only for premium students. For everyone else the flag is ignored, so
 * their questions are simply random (unseen ones still come before repeats).
 */
export function withPriorityFor<T extends { highPriority?: boolean }>(pool: T[], premium: boolean): T[] {
  return premium ? pool : pool.map((q) => (q.highPriority ? { ...q, highPriority: false } : q));
}
