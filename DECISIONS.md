# Decisions

Choices made without asking, with the reason. Change them freely; each says where to look.

## Stack and versions
- **Next.js 16 / React 19, Prisma 7 (`7.10.0`), Tailwind 4, TypeScript 5.9.** Prisma's npm `latest` tag is an 8.0 release candidate, so 7.10 is pinned deliberately. TypeScript 7 was skipped because the ecosystem tooling (ESLint, Next) targets 5.x.
- **Auth.js v5 (`next-auth@5.0.0-beta.32`).** v5 is still tagged beta, but it is the only line that supports the App Router properly. v4 is the `latest` tag. Pinned exactly.
- **Prisma uses the `pg` driver adapter** (required in Prisma 7). The generated client lives in `src/generated/prisma` and is git-ignored by the build (`npm run db:generate`).

## Auth
- **JWT sessions** (the Credentials provider requires them). The user row is re-read on every protected request, and `tokenVersion` is compared with the JWT, so a password reset signs out every device and a demoted admin loses access immediately.
- **argon2id** via `@node-rs/argon2` (prebuilt binaries, no compiler needed on the server).
- **Email verification required before sign-in** (`REQUIRE_EMAIL_VERIFICATION=true`). Verification uses a POST from a button so mail scanners that pre-fetch links cannot use up the token.
- **Sign-up, forgot-password and resend give the same response whether or not the email exists**, to avoid account enumeration.
- **Password rule:** 10–128 characters, no composition rules.
- **Google sign-in later:** `Account` table already exists; see the comment in `src/auth.ts`.

## Data
- **Discipline and subtopic are plain strings validated against `taxonomy.json`**, not DB enums, so editing the taxonomy needs a redeploy but no migration. The JSON is bundled at build time. Renaming an entry also means updating existing rows (a SQL `UPDATE`).
- **Options are shuffled once at import**, and again per practice session (`SessionQuestion.optionOrder`), so students cannot memorise letter positions on repeats. Answers are stored as the canonical option index.
- **Duplicate detection** uses a normalised copy of the stem (`stemNorm`) with a trigram index; `contentHash` (sha256 of the same text) makes seeding and import idempotent.
- **Rate limiting is stored in Postgres** (`RateLimit` table) to avoid requiring Redis. Fixed windows.

## Practice rules (phase 2 will implement)
- Mock: each block of 50 has 25 preclinical + 25 clinical, shuffled within the block. Unseen questions are preferred.
- Exam timer: `EXAM_SECONDS_PER_QUESTION` (default 72s ⇒ 200 questions = 4h). Deadline is fixed at start; no pause.
- Exam → Learn switch is one-way and keeps answers.

## Deployment
- **Standalone Next build** in a slim runtime image. Migrations and seed scripts run from a separate `tools` image target, so the runtime image carries no dev dependencies. Compose runs `prisma migrate deploy` through a one-shot `migrate` service before the app starts.
- The app port is bound to `127.0.0.1` only; a reverse proxy terminates HTTPS.

## Seeding
- `scripts/seed.ts` reads `mdc-mock-200.html` with a literal parser (the file's JavaScript is never executed) and needs a topic map in `scripts/legacy-topic-map.json`. The map has to be filled from the real topic names; the script prints the unmapped ones as a ready-to-fill skeleton.
- `npm run db:seed:dev` creates synthetic fixture questions for development and tests. It refuses to run in production.
