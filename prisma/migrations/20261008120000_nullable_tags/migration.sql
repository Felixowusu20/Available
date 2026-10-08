-- Imported questions may be untagged until an admin or the AI tagger assigns them.
ALTER TABLE "Question" ALTER COLUMN "section" DROP NOT NULL;
ALTER TABLE "Question" ALTER COLUMN "discipline" DROP NOT NULL;
ALTER TABLE "Question" ALTER COLUMN "subtopic" DROP NOT NULL;

-- ...but nothing can reach review or students without a complete set of tags.
ALTER TABLE "Question" ADD CONSTRAINT "Question_tags_required_chk"
  CHECK (
    "status" NOT IN ('IN_REVIEW', 'PUBLISHED')
    OR ("section" IS NOT NULL AND "discipline" IS NOT NULL AND "subtopic" IS NOT NULL)
  );
