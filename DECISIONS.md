# Decisions

Choices made without asking, and why. Change them freely; each says where to look.

## Stack and versions
- **Next.js 16 / React 19, Prisma 7 (`7.10.0`), Tailwind 4, TypeScript 5.9.** Prisma's npm `latest` tag is an 8.0 release candidate, so 7.10 is pinned deliberately. TypeScript 7 was skipped because ESLint and Next target 5.x.
- **Auth.js v5 (`next-auth@5.0.0-beta.32`).** v5 is still tagged beta, but it is the line that supports the App Router properly (v4 is the `latest` tag). Pinned exactly; revisit when v5 is stable.
- **Prisma uses the `pg` driver adapter** (required in Prisma 7). The generated client lives in `src/generated/prisma`, is git-ignored, and is rebuilt on `npm install` and `npm run build`.
- **`nodemailer` 8**, not 10: `next-auth` declares a peer range of 7–8.
- **No UI kit, no chart library.** Charts are plain CSS/SVG; fonts are the system fonts (zero font downloads). This is for slow, expensive mobile data.

## Auth
- **JWT sessions** (the Credentials provider requires them). The user row is re-read on every protected request and `tokenVersion` is compared with the token, so a password reset signs out every device and a demoted admin loses access at once.
- **argon2id** via `@node-rs/argon2` (prebuilt binaries, no compiler needed).
- **Email verification is required before sign-in** (`REQUIRE_EMAIL_VERIFICATION=true`). Verification is a POST from a button, so mail scanners that pre-fetch links cannot use up the token.
- **Sign-up, forgot-password and resend give the same answer whether or not the email exists**, to prevent account discovery.
- **Password rule:** 10–128 characters, no composition rules.
- **Login limiter counts failed attempts only** (8 per email and 30 per IP per 15 minutes), so students who log in often are never locked out. The IP limit is generous because many students share one campus connection.
- **Rate limits are stored in Postgres** (`RateLimit` table) so no Redis is needed and several app instances share them. Fixed windows. The client IP comes from `X-Forwarded-For`, so the reverse proxy must overwrite it (documented in DEPLOYMENT.md).
- **Google sign-in later:** the `Account` table exists; see the comment in `src/auth.ts`.

## Data
- **Discipline and subtopic are strings validated against `taxonomy.json`**, not DB enums, so editing the taxonomy needs a redeploy but no migration. The JSON is bundled at build time. Renaming an entry also means updating existing rows with SQL.
- **Section, discipline and subtopic are nullable** so imports can arrive untagged. A database CHECK constraint refuses `IN_REVIEW` and `PUBLISHED` without all three, and another requires exactly 4 options, so the rules hold even if application code is wrong.
- **Options are shuffled at import, and again per session** (`SessionQuestion.optionOrder`), so letter positions cannot be memorised. Answers are stored as the canonical option index.
- **Duplicates:** a normalised copy of the stem (`stemNorm`) has a trigram index. `contentHash` (sha256 of the same text) makes seeding and imports idempotent. Near-duplicate threshold: 0.8 similarity.

## Reports
- **Students report through their session, not by question id** (`PUT /api/sessions/:id/questions/:pos/report`), so they can only report a question they were served, the browser never handles question ids, and results can be reported after a session has finished.
- **One open report per student per question.** Sending another replaces the reason and note. A partial unique index (`WHERE status = 'OPEN'`, only in the migration SQL because Prisma cannot declare it) keeps this true when two requests arrive together. Once an admin closes a report the student can report the question again.
- **Admins work per question, not per report.** The Reports page groups open reports by question (most reported first) and closes all of a question's open reports together as `RESOLVED` (fixed) or `DISMISSED` (no change needed), with an optional note. A report never changes a question's status by itself: nothing is unpublished automatically, so a few mistaken or malicious reports cannot take questions away from students.
- **Students never see other students' reports or the outcome.** They only see whether they have an open report ("Reported"). Reporter emails are shown to admins only.
- **"The answer looks wrong" and "the explanation is wrong" are only offered once the answer has been shown**, since before that (exam mode) the student cannot judge them. The server accepts any reason.
- **Limits:** 30 reports per student per hour; notes up to 1000 characters (also a database CHECK); "Something else" needs a few words of explanation.

## Practice rules
- **Mock composition:** half preclinical, half clinical; every block of 50 has 25 of each, shuffled together. Unseen questions are preferred; if a section is too small the mock is refused rather than shortened.
- **"Questions left" per topic:** for each section, discipline and subtopic the practice screen shows how many published questions the student has not answered yet. A question counts as answered once the student picks an option in any session (mock or topic, finished or not), the same rule as the dashboard's "seen" and the unseen-first draw; a cleared answer or a flag alone does not count. Draft, in-review and retired questions are not counted, so the number matches what a session can serve. The figures are computed on the server in one grouped query per page load (`getAvailability`), so a student never receives question ids or other students' data; they are not live while a session is running and update when the practice screen is opened again. At zero the label reads "All done"; those questions still come round again after the unseen ones.
- **Exam timer:** `EXAM_SECONDS_PER_QUESTION` (default 72, so 200 questions = 4 hours). The deadline is fixed at the start (no pause). The browser's countdown uses the server's clock, not the device's. A 15-second grace absorbs network delay on the last answer; an expired session is finalised the next time it is read.
- **Exam → learn switch is one-way.** Answers are kept, the timer stops, answered questions show their explanation, and new answers lock on selection.
- **Learn mode locks an answer** once chosen (repeating the same one is accepted so retries are safe).
- **Answers are saved as you go** with retry; learn-mode answers wait for the server because the feedback comes from it.
- **Question sections for the seed:** the file's own PRE/CLI split decides the section (so the bank is exactly 100/100, which a 200-question mock needs). Within that, subtopics are tagged by the knowledge each question tests.

## AI pipeline
- **Structured outputs with enums built from the taxonomy**, plus a code check that the discipline and subtopic belong together; failures are retried up to 3 times with the reason, then failed, never guessed.
- **Quality check is two calls:** the model answers blind first, then reviews with the key and that blind answer. Disagreement adds `ANSWER_KEY_SUSPECT` in code, so the key check does not depend on the model volunteering it.
- **No forced tool use, no sampling parameters, no disabled thinking**: the current models reject them. Effort is set through `output_config.effort` (tagging: `low`; quality: `AI_QUALITY_EFFORT`).
- **Synchronous runs of at most 25 questions** per request, 4 at a time; the browser sends larger selections in chunks. This works on serverless hosts. For many thousands of questions, the Message Batches API (half price, asynchronous) would be the next step.
- **Cost shown is an estimate** from the price table in `src/lib/ai/pricing.ts`; token counts are exact.
- **AI never writes to a question by itself.** `resolveSuggestion` is the only path, requires an admin, and never changes the status.

## Deployment
- **Standalone Next build** in a slim runtime image. Migrations and seed scripts run from a separate `tools` image target, so the runtime image carries no dev dependencies. Compose runs `prisma migrate deploy` through a one-shot `migrate` service before the app starts.
- **The app port is bound to `127.0.0.1`**; a reverse proxy terminates HTTPS. The database port is not published.
- **Backups are `pg_dump` + gzip** with a script and a restore script that stops the app and restores in one transaction.

## Testing
- **Three layers:** unit tests (no database), integration tests against a real `mdc_test` PostgreSQL database, and Playwright against a production build. The last two refuse to run against any database not named `*_test`.
- **E2E helpers talk to Postgres directly** rather than importing app code, so the tests stay independent of how the app is built.

## Seeding
- `scripts/seed.ts` reads `mdc-mock-200.html` with a literal parser (its JavaScript is never executed), takes the discipline from `legacy-topic-map.json` and the subtopic from `legacy-question-tags.json`, and refuses to run if the file no longer matches the tags' fingerprint.
- `npm run db:seed:dev` creates labelled placeholder questions for development and tests; it refuses to run in production.
- **The subtopic tags were assigned by an AI model and have not been reviewed by a clinician.** Review them, or correct them in the admin UI.
