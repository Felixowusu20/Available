# Handover: practise one section, and the GHS 10 premium unlock

Branch **`feature/premium-unlock`**. It contains everything in `feature/all-features` (the three earlier features, see `HANDOVER.md`) **plus** two new things: practising one section on its own, and a one-time GHS 10 payment that unlocks the new features. Merge or deploy this one branch instead of `feature/all-features`.

**The one thing that must not be skipped:** Vercel does not run migrations. Three migrations must be applied to the hosted database **before** the new code goes live:

```
20261011000000_question_high_priority      (from the earlier features)
20261011120000_question_reports            (from the earlier features)
20261021000000_premium_unlock              (new: a Payment table and two columns on User)
```

Follow the same safe, read-only-first steps as in `HANDOVER.md` section "Deploying".

## What is new

| | What students and admins get | Where to look |
|---|---|---|
| **Practise one section** | A "Practise one section" card on the Practice page: choose Preclinical or Clinical, how many questions (20, 50, 100 or any number from 5 to 200) and Learn or Exam mode. Unanswered questions come first. It is topic practice with a new "whole section" filter, so it needs no migration of its own. | `src/lib/practice/schemas.ts`, `service.ts`, `src/app/(app)/practice/start-practice.tsx` |
| **Premium unlock, GHS 10, one time, for life** | A student pays once through Paystack (Mobile Money or card). Admins can also give or remove premium for free. | `src/lib/premium/`, `src/app/(app)/unlock/`, `src/app/(app)/admin/premium/` |

**What premium unlocks:** (1) practising one section, (2) the "questions left" counters, (3) unseen high-priority questions being drawn first. **Report a question stays free.** Mock exams, topic practice, redo missed and bookmarks stay free. Admin accounts always have every feature.

The locks are enforced on the **server**: a free student who sends a section-practice request by hand gets `402`; the counters are not even loaded for them; the high-priority flag is ignored when their questions are drawn.

## How a payment becomes premium (read this before changing anything)

1. The student presses *Unlock premium* on `/unlock`. The server records a `Payment` (PENDING) at the server's price and asks Paystack for a checkout page. The browser never sends an amount.
2. Paystack calls `POST /api/paystack/webhook`. The body's HMAC-SHA512 signature (`x-paystack-signature`) is checked with the secret key; a bad one gets `401`. The amount and currency must match; a payment is claimed with one atomic update, so a repeated or simultaneous delivery unlocks once.
3. **Only that webhook, or an admin's "Re-check with Paystack" (which asks Paystack directly), can set premium.** The page Paystack sends the student back to (`/unlock/callback`) only reads the database and refreshes every 3 seconds. A unit test (`src/lib/premium/guard.test.ts`) reads the source and fails if any other file starts setting premium.
4. A payment for an account that already has premium (for example an admin gave it first) is recorded and flagged on **Admin, Premium** for a refund; the account keeps its original date.

## Environment variables (new)

| Variable | Meaning |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack secret key. Use the **test** key (`sk_test_...`) first. Empty means payments are off and `/unlock` says "opens soon". |
| `PAYSTACK_ALLOW_LIVE` | Leave `false`. A `sk_live_` key is refused unless this is `true`, so a live key cannot be used by accident. |
| `PREMIUM_PRICE_PESEWAS` | Price in pesewas. Default `1000` = GHS 10. |

Set them in Vercel's environment settings, never in the repository. The developer adds the Paystack keys.

## Setting up Paystack (test mode first)

1. In the Paystack dashboard, switch to **Test mode** and copy the Secret key into `PAYSTACK_SECRET_KEY`.
2. Settings, API Keys & Webhooks: set the **Test Webhook URL** to `https://<your-domain>/api/paystack/webhook`.
3. Sign in as a student, open **Premium** in the menu, pay with one of Paystack's test Mobile Money or card numbers, and watch the status page change to "Premium is unlocked".
4. If a webhook ever fails to arrive, **Admin, Premium** lists payments not confirmed after 10 minutes with a **Re-check with Paystack** button.
5. To go live: create the live key, set `PAYSTACK_ALLOW_LIVE=true`, replace the key, and set the **Live Webhook URL**. Only after the test-mode run-through works end to end.

## Admin tools (Admin, Premium)

Give premium to an account by email, remove it again (do the money refund itself in the Paystack dashboard), see everyone who has it and how they got it, and handle payments that need attention.

## Tests

- Unit: `npm test` (signature check, money, the "who can set premium" guard, section schema).
- Integration: `npm run test:integration` (webhook idempotency including three simultaneous deliveries, wrong amount, replays, grant and revoke, section practice refused for free accounts and allowed for premium, priority ignored for free accounts, all earlier suites with students premium by default).
- Browser: `PW_CHANNEL=msedge npx playwright test` or install Chromium once. `tests/e2e/premium.spec.ts` covers the locked screen, the webhook journey and the admin tools.

## Not in this branch

- Refund automation (a refund is done in the Paystack dashboard, then *Remove premium* here).
- A receipt email. Paystack sends its own.
