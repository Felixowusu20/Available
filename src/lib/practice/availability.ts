import { db } from "@/lib/db";
import { rollUp, type Availability, type AvailabilityRow } from "@/lib/practice/topic-counts";

/**
 * How many published questions each topic has, and how many of them this student has not answered yet.
 * A question counts as answered as soon as the student picks an option in any session (mock or topic,
 * finished or not), the same rule the dashboard and the "unseen first" draw use. Retired, draft and
 * in-review questions are not counted, so the number matches what a session can actually serve.
 */
export async function getAvailability(userId: string): Promise<Availability> {
  const rows = await db.$queryRaw<AvailabilityRow[]>`
    SELECT q."discipline", q."subtopic",
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE s."questionId" IS NOT NULL) AS seen
    FROM "Question" q
    LEFT JOIN (
      SELECT DISTINCT "questionId" FROM "Answer" WHERE "userId" = ${userId} AND "selectedIndex" IS NOT NULL
    ) s ON s."questionId" = q."id"
    WHERE q."status" = 'PUBLISHED' AND q."discipline" IS NOT NULL AND q."subtopic" IS NOT NULL
    GROUP BY q."discipline", q."subtopic"`;
  return rollUp(rows);
}
