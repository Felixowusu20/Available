-- Lets an admin mark questions as high priority so students meet them early.
-- Existing questions stay normal priority.
ALTER TABLE "Question" ADD COLUMN "highPriority" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Question_status_highPriority_idx" ON "Question"("status", "highPriority");
