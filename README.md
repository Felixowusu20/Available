# Available

A web platform for Ghanaian medical students preparing for the **Medical and Dental Council (MDC) licensure exam**: 200 single-best-answer MCQs, 100 preclinical and 100 clinical.

Students take timed mocks, learn from explanations, and see their weak topics. Admins grow the question bank with AI-assisted tagging and review.

**Documents:** [DEPLOYMENT.md](DEPLOYMENT.md) (hosting, backups, HTTPS, troubleshooting) · [DECISIONS.md](DECISIONS.md) (choices made and why)

## What it does

**Students**
- **Learn mode** – pick an answer, see the explanation at once, move on. Answers lock.
- **Exam mode** – timed, no feedback until the end; change answers, jump around with the question map, flag for review.
- **Switch exam → learn** at any point without losing answers.
- **Mocks of 50, 100 or 200** questions: always half preclinical, half clinical, mixed, with 25 of each in every block of 50.
- **Topic practice** by discipline and/or subtopic, **redo missed**, **bookmarks**.
- **High-priority questions**: an admin can flag questions so students meet them first (see below). Students never see the flag.
- "I am guessing" on every question; results report guesses separately.
- Progress is saved on the server and resumes on any device.
- Results: score, preclinical/clinical split, per-block and per-topic breakdown (weakest first), missed questions with explanations. Dashboard: history, accuracy trend, weakest topics, seen vs remaining.
- Mobile first, light and dark theme, no UI or chart library, keyboard shortcuts on desktop (A–D or 1–4 to answer, Enter for next, F flag, B bookmark, M map).

**Admins**
- Question list with search and filters; editor; bulk status changes; **high priority** flag (editor checkbox, bulk mark/clear, list filter, dashboard count).
- Import from JSON or CSV with a row-by-row preview, duplicate and near-duplicate detection. Imports always start as drafts.
- **AI review** – tagging and quality checks (see below). AI output is only ever a suggestion; nothing is applied or published without an admin accepting it.
- Only `PUBLISHED` questions ever reach students.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL 16 + Prisma 7 · Auth.js v5 (email + password, argon2id) · Zod · Anthropic SDK (server side only) · Vitest · Playwright · Docker.

## Run it locally

You need **Node 22+** and **Docker** (for PostgreSQL).

```bash
# 1. Configuration. Edit .env: set AUTH_SECRET (openssl rand -base64 32) and the ADMIN_SEED_* values.
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
```

```bash
# 2. Database (PostgreSQL 16 on localhost:5432; also creates a separate mdc_test database)
docker compose -f docker-compose.dev.yml up -d
```

```bash
# 3. Install, create the tables, create your admin account, load the questions
npm install
npx prisma migrate deploy
npm run db:seed:admin           # admin from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD
npm run db:seed                 # the 200 MDC mock questions (mdc-mock-200.html)
```

```bash
# 4. Start
npm run dev                     # http://localhost:3000
```

Without SMTP configured, emails are not sent: **verification and password-reset links are printed in the terminal** running the app. No `ANTHROPIC_API_KEY` is needed to run the app; AI features then show as unavailable.

No real questions yet? `npm run db:seed:dev` adds 240 clearly-labelled placeholder questions (it refuses to run in production).

## Tests

```bash
npm run lint && npm run typecheck
npm test                         # unit tests, no database needed
npm run test:integration         # against the real mdc_test database (docker compose -f docker-compose.dev.yml up -d)
npx playwright install chromium  # once
npm run test:e2e                 # builds the app and drives a real browser
```

Set `PW_CHANNEL=chrome` (or `msedge`) to use a browser you already have instead of downloading Chromium. The integration and end-to-end suites only run against a database whose name ends in `_test`, and refuse anything else.

## Importing questions

Admin → **Import**. A JSON file is an array of objects:

```json
[{
  "stem": "Which nerve supplies the deltoid?",
  "options": ["Axillary", "Radial", "Ulnar", "Median"],
  "correct": "A",
  "explanation": "…",
  "discipline": "Anatomy", "subtopic": "Upper limb",
  "difficulty": "easy", "source": "Past paper 2024"
}]
```

Only `stem`, `options` (exactly 4) and the correct answer are required. `correct` is a letter A–D or a number 1–4; `correctIndex` is 0–3. Tags are optional and must match [taxonomy.json](taxonomy.json) (case-insensitive); untagged questions can be tagged by the AI or by hand. CSV works too (columns `stem`, `options` separated by `|` or `A`–`D`, `correct`, …). The importer shows every row's status before saving anything. An optional `priority` (or `highPriority`) column marks a row high priority: `high`, `true`, `yes` or `1`; anything else is normal.

## High-priority questions

Admins can mark any question **High priority**: tick the box in the editor, or select questions in the list and use *Mark high priority* or *Remove priority*, and filter with *High priority only*. The flag does not change what students are allowed to see. It only changes the order in which questions are drawn:

1. unseen high-priority questions, then
2. other unseen questions, then, only when the unseen ones run out,
3. seen high-priority questions, then other seen questions.

This applies to **mocks** and **topic practice**. Questions are still shuffled within a session, and in a mock they are spread across the blocks, so the 25/25 preclinical/clinical rule is unchanged. Redo-missed and bookmark sessions are the student's own lists and ignore priority. Only published questions are ever drawn, so flagging a draft has no effect until it is published. The flag is never sent to the browser.

**Large files from the command line.** `scripts/import-file.ts` runs the same validation and duplicate checks as the Import screen, which is handier for thousands of questions (it can also publish the tagged ones in one step):

```bash
npx tsx scripts/import-file.ts "C:\path\questions.json"                    # preview only, writes nothing
npx tsx scripts/import-file.ts "C:\path\questions.json" --commit           # import as drafts
npx tsx scripts/import-file.ts "C:\path\questions.json" --commit --publish # ...and publish the tagged ones
npx tsx scripts/verify-bank.ts                                             # report on the bank and test the mock rules
```

It prints the database it is about to write to before doing anything; check that line. To load a hosted database, set `DATABASE_URL` in your shell first (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## The AI features

Needs `ANTHROPIC_API_KEY`. Models and effort are set in `.env` (`AI_TAGGING_MODEL`, `AI_QUALITY_MODEL`, `AI_QUALITY_EFFORT`), so they can change without code edits.

- **Tagging** returns section, discipline, subtopic, difficulty and a confidence. Names are constrained to the taxonomy, and an invalid combination is rejected and retried, then failed rather than guessed. The rule given to the model: *tag by the knowledge tested, not by how it is framed* (a clinical scenario asking which nerve is injured is Anatomy, so PRECLINICAL).
- **Quality check** answers each question blind first, then reviews it with the key. It flags a suspect answer key, more than one defensible answer, a missing or weak explanation, and unsafe or outdated drug information, and drafts an explanation when one is missing.
- **Duplicates** are found with PostgreSQL `pg_trgm` similarity on normalised stems.
- Runs are limited to 25 questions per request, retried on rate limits, and log tokens (and an estimated cost) per run on the AI review page.

To change the taxonomy edit `taxonomy.json` and redeploy; the app and the AI prompts both read it.

## Project layout

```
prisma/                 schema and committed migrations
taxonomy.json           the one editable taxonomy (app and AI read it)
mdc-mock-200.html       the original 200 questions (seed source)
scripts/                seed, backup/restore, verification scripts
src/app/                pages and API routes (App Router)
  (app)/                signed-in area: dashboard, practice, results
  (app)/admin/          admin area: questions, import, AI review
  api/                  route handlers (sessions, account, admin, health)
src/lib/                server logic: practice, admin, ai, auth, rate limiting, email
src/components/         small shared UI pieces
tests/integration/      tests against PostgreSQL
tests/e2e/              Playwright browser tests
Dockerfile, docker-compose*.yml
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm run db:migrate` | Create a new migration while developing |
| `npm run db:deploy` | Apply migrations (what production does) |
| `npm run db:seed:admin` | Create or reset the admin from `ADMIN_SEED_*` |
| `npm run db:seed -- --check` | Validate the 200 questions without writing |
| `npx tsx scripts/verify-seed.ts` | Read-only summary of the question bank |
| `./scripts/backup.sh`, `./scripts/restore.sh` | Database backup and restore ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| `GET /api/health` | 200 when the app can reach the database |

## Security in brief

Secrets live only in environment variables (never sent to the browser; `.env` is git-ignored). Passwords are hashed with argon2id; verification and reset tokens are single-use, hashed and expire. Every admin page and API route checks the admin role against the database. Students can only read their own sessions, and questions are served per session: there is no endpoint that lists the bank. Login, sign-up, password-reset and AI endpoints are rate limited. Security headers (CSP, HSTS in production, frame and content-type protection) are set in `next.config.ts`. Logs are structured JSON on stdout and never contain secrets or students' answers.
