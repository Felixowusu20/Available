# Handover: three new features, one branch

Branch **`feature/all-features`** contains all three features below, merged and tested together. Merge or deploy **this one branch**. Do not also merge the three separate branches: they are already inside it (they still exist on GitHub for review, `feature/high-priority-questions`, `feature/questions-left-per-subject` and `feature/report-question`).

**The one thing that must not be skipped:** the features add two database migrations, and Vercel does not run migrations. Run them against the hosted database **before** the new code goes live (steps below).

## What is new

| Feature | What students and admins get | Where to look |
|---|---|---|
| **High-priority questions** | Admins flag questions as *High priority* (in the question editor, or in bulk from the question list, and filter with *High priority only*). When a student starts a session, unseen high-priority questions are drawn first, then other unseen ones, then seen high-priority, then seen. Students never see the flag. | `src/lib/practice/compose.ts`, `src/lib/admin/questions.ts`, admin question pages; README section "High-priority questions" |
| **Questions left** | The practice screen shows "N left" next to every section, discipline and subtopic ("All done" at zero) and, once topics are picked, how many unanswered questions the selection holds. A question counts as answered once the student picks an option in any session. Computed on the server in one grouped query. | `src/lib/practice/availability.ts`, `src/lib/practice/topic-counts.ts`, `src/app/(app)/practice/` |
| **Report a question** | Students get a *Report a problem* button on every question while practising and on missed questions in their results (reason + optional note). Admins get **Admin → Reports**: questions ranked by number of open reports, each with reasons, notes and who sent them, and can close a question's reports as *fixed* or *no change needed*. The admin home has a tile and the nav shows how many questions are waiting; the question list can be filtered to *Has open reports*. | `src/lib/reports.ts`, `src/lib/report-reasons.ts`, `src/components/report-dialog.tsx`, `src/app/(app)/admin/reports/`, `src/app/api/sessions/[id]/questions/[pos]/report/` |

Behaviour to know about reports (details in `DECISIONS.md`): one open report per student per question (sending again replaces it); at most 30 reports per student per hour; a report never unpublishes or changes a question by itself; students only ever see whether they have reported a question, never other students' reports.

## Deploying (Vercel + hosted Postgres)

No new environment variables. Nothing else about the deployment changes (see `DEPLOYMENT.md` section 5b for the general Vercel setup).

Do the database first, then the code. Run these from your own machine, with the **direct (non-pooled)** connection string set **in your shell** (not in `.env`, because the scripts read the shell first and fall back to `.env`, which would quietly point at a local database):

```bash
export DATABASE_URL="<hosted DIRECT connection string>"     # PowerShell: $env:DATABASE_URL = "..."

# 1. Read-only safety check. Stop if it prints STOP (another app's tables, or tables without migration history).
npx tsx scripts/check-deployment.ts

# 2. Read-only. Lists what is still to be applied. Expect these two (one of them may already be
#    applied if it was run earlier, which is fine), and nothing else:
#      20261011000000_question_high_priority
#      20261011120000_question_reports
npx prisma migrate status

# 3. Apply them.
npx prisma migrate deploy
```

Then merge `feature/all-features` into `main` (or deploy the branch) so Vercel builds it.

What the migrations do (both are additive, so existing data is untouched):

- `20261011000000_question_high_priority`: adds `Question.highPriority` (boolean, default false) and an index.
- `20261011120000_question_reports`: adds the `QuestionReport` table, two enums (`ReportReason`, `ReportStatus`), indexes, a partial unique index that keeps one open report per student per question, and a length CHECK on notes.

Because they only add things, the previous version of the app keeps working against the new schema. If the release has to be rolled back, redeploy the old code; the database does not need to be reverted.

## After deploying: five-minute check

- [ ] `https://<site>/api/health` returns ok.
- [ ] As a student: **Practice** shows "N left" beside Preclinical, Clinical and each discipline; start a short topic session, answer one question, return to Practice and see the number go down by one.
- [ ] In the same session, press **Report a problem**, choose a reason and send. The button then reads "Reported".
- [ ] As an admin: **Reports** (in the Admin bar) lists that question with the reason. Close it with **No change needed** so a test report does not stay open.
- [ ] As an admin: a question's edit page has a **High priority** checkbox, and the question list has the *High priority only* and *Has open reports* filters.

## Running the tests

```bash
npm run typecheck
npm run lint
npm test                                  # unit tests
docker compose -f docker-compose.dev.yml up -d
npm run test:integration                  # real Postgres (database mdc_test, never your dev data)
npm run test:e2e                          # builds the app and drives a browser: slow and heavy; PW_CHANNEL=msedge uses an installed Edge
```

State when this was handed over: type check and lint clean; 75 unit, 77 integration and 15 browser tests pass on this branch.

On Windows PowerShell, `npm` may be blocked by the execution policy; `npm.cmd run dev` (and `npm.cmd test` and so on) avoids that without changing any setting.

## Not in this branch

- **No question content.** The questions are loaded separately, through **Admin → Import** or `npx tsx scripts/import-file.ts "<file>"` (preview first; `--commit` imports as drafts). Imported questions are drafts and need review before they are published.
- **No answers to reports for students.** A student cannot see what happened to their report. If that is wanted later, `QuestionReport` already stores the outcome (`status`, `resolutionNote`, `resolvedAt`).
