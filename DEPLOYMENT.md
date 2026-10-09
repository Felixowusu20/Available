# Deployment guide

This guide takes you from an empty server to a running, backed-up site with HTTPS. It covers a single VPS with Docker Compose (the simplest path) and managed platforms with managed PostgreSQL. Nothing here is tied to one provider.

## 1. What you are deploying

| Piece | What it is |
|---|---|
| **app** | One Node.js container (Next.js, port 3000). Stateless: all data is in PostgreSQL. |
| **PostgreSQL 16** | Holds everything. Needs the `pg_trgm` extension (the first migration creates it). |
| **migrate** | A one-shot container that runs `prisma migrate deploy` before the app starts. |
| **reverse proxy** | Nginx or Caddy in front, terminating HTTPS. **Required**, see section 6. |

Optional: an SMTP account for email (sign-up verification and password reset), and an Anthropic API key for the AI features.

### Requirements

- A Linux server with **2 GB RAM or more** (building the image needs it; add 2 GB swap on a 1 GB server), 10 GB disk.
- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- A domain name pointing at the server, ports 80 and 443 open.
- SMTP credentials from any provider (needed for real users: without them nobody can verify their email).

## 2. Environment variables

Everything is configured through environment variables; [.env.example](.env.example) lists them all with comments. The important ones:

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Docker Compose only. Password for the bundled database. |
| `DATABASE_URL` | PostgreSQL connection string. Used on managed platforms; Compose builds its own. |
| `APP_URL` | Public address, e.g. `https://practice.example.com` (no trailing slash). Used in emailed links. |
| `AUTH_SECRET` | Signs session cookies. Generate: `openssl rand -base64 32`. Keep it secret and stable. |
| `AUTH_TRUST_HOST` | `true` (the app runs behind a proxy). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Email. With no `SMTP_HOST` no email is sent; in development the link is printed in the log, in production it is deliberately **not** logged (a logged reset link is as good as a password). |
| `ANTHROPIC_API_KEY` | Optional. Without it the app runs and AI features say "unavailable". |
| `AI_TAGGING_MODEL`, `AI_QUALITY_MODEL`, `AI_QUALITY_EFFORT` | Which models the AI uses. Change without code edits. |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | The first admin (section 3). |
| `EXAM_SECONDS_PER_QUESTION` | Exam time per question (default 72, so 200 questions = 4 hours). |
| `REQUIRE_EMAIL_VERIFICATION` | Leave `true` in production. |
| `DATABASE_POOL_MAX` | Connections per app process (default 10). Lower on small managed plans. |

Never commit `.env`. On managed platforms set these in the platform's secret store instead.

## 3. First deploy on a VPS (Docker Compose)

```bash
# On the server
git clone <your repository> /opt/mdc && cd /opt/mdc
cp .env.example .env
nano .env        # set POSTGRES_PASSWORD, APP_URL, AUTH_SECRET, SMTP_*, ADMIN_SEED_*, optionally ANTHROPIC_API_KEY
```

Start everything. The first run builds the image (a few minutes). The `migrate` container applies all migrations and exits; the app starts only if that succeeded:

```bash
docker compose up -d --build
docker compose ps                  # db and app "running"/"healthy"; migrate "exited (0)"
docker compose logs migrate        # should end with "All migrations have been successfully applied."
```

Create the first admin, then load the 200 mock questions:

```bash
docker compose --profile tools run --rm tools npm run db:seed:admin
docker compose --profile tools run --rm tools npm run db:seed
```

Both can be re-run safely. Then set up HTTPS (section 6) and check:

```bash
curl -s https://practice.example.com/api/health      # {"status":"ok"}
```

Sign in at `/login` with the admin email and password from `.env`, open **Admin**, and publish or import further questions.

> The app container listens on `127.0.0.1:3000` only, so it is not reachable from the internet until your proxy is set up. The database is not published to the host at all.

## 4. Updating

```bash
cd /opt/mdc
./scripts/backup.sh                  # always back up first
git pull
docker compose up -d --build         # rebuilds, runs new migrations, restarts the app
docker compose logs --tail 50 migrate app
```

### Migrations

- Migrations live in `prisma/migrations/` and are **forward-only**. `docker compose up` runs `prisma migrate deploy` through the `migrate` service on every start; it only applies migrations not yet applied, and is safe to repeat.
- To run them by hand: `docker compose run --rm migrate`.
- If a migration fails, the app does **not** start (it waits for `migrate` to succeed) and the old container keeps running. Read `docker compose logs migrate`, fix, and re-run.
- To undo a bad release: `git checkout <previous commit>`, then restore the backup taken before the update (section 8) if the new migrations changed the schema.

**Order of steps on any platform:** build the image → apply migrations → start the new app version. Never start a new version against an old schema.

## 5. Managed platforms (managed PostgreSQL)

Any platform that runs a Docker image works (Render, Railway, Fly.io, DigitalOcean App Platform, AWS ECS/App Runner, Azure Container Apps, Google Cloud Run, Kubernetes, ...).

1. **Create a PostgreSQL 14+ database.** The migration runs `CREATE EXTENSION pg_trgm`. `pg_trgm` is a *trusted* extension, so the database owner can create it on PostgreSQL 13+; if your provider forbids it, enable `pg_trgm` once from its console.
2. **Build the `runner` image** from the repository's `Dockerfile` (the default final stage) and deploy it. Port 3000. Health check path: `/api/health`.
3. **Set the environment variables** from section 2, with `DATABASE_URL` pointing at the managed database (add `?sslmode=require` if the provider needs TLS).
4. **Run migrations before each deploy.** The runtime image deliberately contains no Prisma CLI. Use one of:
   - the platform's pre-deploy / release command with an image built from the `tools` stage (`docker build --target tools -t mdc-tools .`) running `npx prisma migrate deploy`; or
   - from your laptop or CI, before releasing: `DATABASE_URL="<managed url>" npx prisma migrate deploy`.
5. **Seed once**, the same way: `DATABASE_URL=... ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npm run db:seed:admin` and `npm run db:seed`.
6. The platform terminates HTTPS. Make sure it **overwrites `X-Forwarded-For`** with the real client address (most do). See the rate-limiting warning in section 6.

Run **one** app instance at first; more are fine (sessions are in signed cookies, rate limits are in the database), but size `DATABASE_POOL_MAX` so instances × pool ≤ your plan's connection limit.

### 5b. Deploying on Vercel

Vercel builds the app itself (framework preset **Next.js**, default build command `npm run build`); the Dockerfile is not used. It needs a PostgreSQL database reachable from Vercel (Vercel Postgres, Neon, Supabase, or your own).

**Set these environment variables for the *Production* environment** (Project → Settings → Environment Variables), then **redeploy**: changes only apply to new deployments.

| Variable | Notes |
|---|---|
| `AUTH_SECRET` | **Required.** If it is missing, every `/api/auth/*` route returns `500 "There was a problem with the server configuration"` and **nobody can sign in**, while `/api/health` still says ok. Generate with `openssl rand -base64 32`. |
| `DATABASE_URL` | Use the provider's **pooled** connection string (Neon: the `-pooler` host; Supabase: the transaction pooler on port 6543). Serverless functions open many short connections. |
| `DATABASE_POOL_MAX` | `1` to `3`. Each function instance keeps its own pool. |
| `APP_URL` | The public address, e.g. `https://tertiaryguide-available.vercel.app` (or your custom domain). Emailed links are built from it. |
| `AUTH_TRUST_HOST` | `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | **Required in practice.** Email verification is on, and production never logs links, so without SMTP only the seeded admin can sign in. |
| `ANTHROPIC_API_KEY` and `AI_*` | Optional. |

**Create the tables and the first data from your own machine**, pointing at the production database (Vercel does not run migrations for you):

```bash
export DATABASE_URL="<production connection string>"       # PowerShell: $env:DATABASE_URL = "..."
npx prisma migrate deploy
ADMIN_SEED_EMAIL="you@example.com" ADMIN_SEED_PASSWORD="a long passphrase" npm run db:seed:admin
npm run db:seed
```

Run `npx prisma migrate deploy` again after every release that adds a migration, **before** (or immediately after) the deploy goes live.

**Check it worked** (no login needed):

```bash
curl -s https://<your-site>/api/auth/csrf        # must return {"csrfToken":"..."}; a 500 means AUTH_SECRET is missing
curl -s https://<your-site>/api/health           # {"status":"ok"}
```

Notes: AI runs set `maxDuration = 300` seconds; if your Vercel plan allows less, Vercel caps it, so run fewer questions at a time. The first request after idle time is slower (a cold start of a few seconds).

**If the admin (or anyone) cannot sign in after deploying**, first note which message the sign-in page shows, then run the checker against the *hosted* database:

| Message on the sign-in page | Meaning |
|---|---|
| "Incorrect email or password" | No such account in the hosted database (most often the admin was created in your **local** database), a typo, or a different password. |
| "We couldn't sign you in right now" | The database has no tables (migrations not run) or can't be reached. |
| "Too many attempts" | 8 failed tries in 15 minutes for that email; wait, or clear it (below). |
| "Please verify your email first" | An ordinary sign-up that is not verified yet (the seeded admin is already verified). |

```bash
# PowerShell; bash: export DATABASE_URL="..."
$env:DATABASE_URL = "<the HOSTED database connection string>"     # type it here; do not rely on .env
npx tsx scripts/check-deployment.ts --email you@example.com
$env:CHECK_PASSWORD = "<the password you are trying>"; npx tsx scripts/check-deployment.ts --email you@example.com
npx tsx scripts/check-deployment.ts --email you@example.com --clear-login-limits    # lifts a lockout
```

It reports whether the migrations ran, whether an admin exists, whether the password matches, and whether the email is locked out, and says what to run to fix each. It never prints passwords or hashes. The seed scripts and `prisma migrate deploy` read `DATABASE_URL` from your shell first and from `.env` only if the shell has none, so **set it in the shell before running them** or they will quietly target your local database.

## 6. HTTPS and the reverse proxy

> **Important – rate limiting depends on the proxy.** Login, sign-up and AI limits are keyed on the client IP taken from `X-Forwarded-For`. Your proxy must **overwrite** that header with the real client address (the examples below do). If it passes along whatever the client sent, attackers can dodge the limits. If it does not set it at all, every user shares one IP and the limit locks everyone out. Test it (section 10).

### Option A: Caddy (automatic HTTPS, least work)

`/etc/caddy/Caddyfile`:

```
practice.example.com {
    encode zstd gzip
    request_body {
        max_size 8MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Caddy gets and renews the certificate itself and sets `X-Forwarded-For` / `X-Forwarded-Proto` correctly. `sudo systemctl reload caddy`.

### Option B: Nginx + Let's Encrypt

```nginx
server {
    listen 80;
    server_name practice.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name practice.example.com;

    ssl_certificate     /etc/letsencrypt/live/practice.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/practice.example.com/privkey.pem;

    client_max_body_size 8m;          # question imports up to 5 MB
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, do NOT append $proxy_add_x_forwarded_for
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;        # AI runs can take a few minutes
    }
}
```

Get the certificate with `sudo certbot certonly --webroot -w /var/www/certbot -d practice.example.com`, then `sudo nginx -t && sudo systemctl reload nginx`. Certbot installs a renewal timer.

The app adds security headers itself (CSP, HSTS in production, X-Frame-Options, ...). Session cookies are marked secure automatically when the request arrives over HTTPS, which is why the proxy must send `X-Forwarded-Proto` (both examples do).

## 7. Creating admins and rotating secrets

### Admins

- **New or reset admin:** set `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` (at least 10 characters) in `.env`, then `docker compose --profile tools run --rm tools npm run db:seed:admin`. If the email already exists it is promoted to admin and its password reset.
- **Promote an existing student:**
  ```bash
  docker compose exec db psql -U mdc -d mdc -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'person@example.com';"
  ```
- **Demote:** the same with `'STUDENT'`. It takes effect immediately; roles are checked against the database on every request.

After seeding, remove `ADMIN_SEED_PASSWORD` from `.env` (or change it): it is only used by that command.

### Rotating secrets

| Secret | How |
|---|---|
| `AUTH_SECRET` | Change it in `.env`, `docker compose up -d`. **Everyone is signed out** (their cookies no longer verify). Otherwise harmless. |
| Database password | `docker compose exec db psql -U mdc -d mdc -c "ALTER USER mdc PASSWORD 'new-password';"`, then set the same value as `POSTGRES_PASSWORD` in `.env` and `docker compose up -d`. (Changing only `.env` does **not** change a database that already exists.) |
| `ANTHROPIC_API_KEY` | Create a new key in the Anthropic console, update `.env`, `docker compose up -d`, then revoke the old key. |
| SMTP password | Update `.env`, `docker compose up -d`. |
| A user's password | They use *Forgot password*; a reset also signs them out everywhere. Admins: re-run `db:seed:admin`. |

If a secret may have leaked, rotate it, and check the logs and the AI run table for unexpected use.

## 8. Backups and restore

Backups are logical dumps of the whole database (questions, users, sessions, answers).

```bash
./scripts/backup.sh            # writes backups/mdc-YYYY-MM-DD_HHMMSS.sql.gz, keeps 14 days
```

**Daily, automatically** (cron, here 02:30):

```bash
crontab -e
30 2 * * * cd /opt/mdc && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Copy backups off the server** (rsync, rclone to object storage, your provider's snapshots). A backup on the same disk does not survive losing the server. On managed PostgreSQL, also enable the provider's automated backups and point-in-time recovery; `backup.sh` is for the Compose database.

`KEEP_DAYS=30 BACKUP_DIR=/mnt/backups ./scripts/backup.sh` changes retention and location.

### Restore

```bash
./scripts/restore.sh backups/mdc-2026-10-08_023000.sql.gz
```

It asks you to type the database name, stops the app, replaces the database contents in a single transaction (all or nothing), and starts the app again.

### Rehearse it (do this once, before you need it)

```bash
docker compose exec db psql -U mdc -d postgres -c "CREATE DATABASE mdc_restore_test;"
DB_NAME=mdc_restore_test ./scripts/restore.sh backups/<latest>.sql.gz
docker compose exec db psql -U mdc -d mdc_restore_test -c "SELECT count(*) FROM \"Question\";"
docker compose exec db psql -U mdc -d postgres -c "DROP DATABASE mdc_restore_test;"
```

## 9. Logs, health and monitoring

- **Health:** `GET /api/health` returns `200 {"status":"ok"}` when the app can reach the database, `503` otherwise. Point an uptime monitor at it. Docker also uses it as the container health check.
- **Logs:** one JSON object per line on stdout: `docker compose logs -f app`. They contain no passwords, tokens, API keys or students' answers. Ship them to your log service if you have one.
- **AI cost:** Admin → AI review lists every run with token counts and an estimated cost.

## 10. Checklist after the first deploy

- [ ] `https://<domain>/api/health` returns ok; HTTP redirects to HTTPS.
- [ ] Sign up a test student with a real mailbox; the verification email arrives and the link works.
- [ ] Admin sign-in works and **Admin** is visible; a student cannot open `/admin`.
- [ ] Rate-limit sanity: from two different networks, a wrong password five times on one account does not lock the other network's login to a different account. (If it does, the proxy is not passing the real client IP.)
- [ ] A backup file exists and a rehearsal restore worked.
- [ ] `.env` is not in git; `ADMIN_SEED_PASSWORD` removed; firewall allows only 22, 80, 443.
- [ ] Optional: add the AI key and run **AI tag** on a few questions.

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` stops with "set POSTGRES_PASSWORD in .env" | The variable is missing from `.env`. |
| `migrate` container fails: `permission denied to create extension "pg_trgm"` | Database user can't create extensions. Run `CREATE EXTENSION pg_trgm;` once as a superuser/owner, then re-run migrations. |
| `migrate` fails: `password authentication failed` | `POSTGRES_PASSWORD` in `.env` differs from the password the existing database volume was created with. Use `ALTER USER` (section 7) or, only if the data is disposable, `docker compose down -v` to recreate the volume. |
| Site shows a bad-gateway error | App not running or still starting: `docker compose ps`, `docker compose logs app`. Check the proxy points at `127.0.0.1:3000`. |
| Sign-in works, then you are sent back to the login page | `APP_URL` doesn't match the real address, or the proxy isn't sending `X-Forwarded-Proto: https`. Check `AUTH_TRUST_HOST=true`. |
| Everyone suddenly signed out | `AUTH_SECRET` changed or is not set the same on every instance. |
| "Too many attempts" for people who did nothing wrong | The proxy isn't passing the real client IP (all users share one). Fix the `X-Forwarded-For` header (section 6). |
| Verification / reset emails never arrive | `SMTP_HOST` is empty (the log then says "SMTP is not configured"), wrong credentials, or the sender domain lacks SPF/DKIM so mail lands in spam. Check `docker compose logs app` for that message or for send errors. |
| AI buttons say unavailable | `ANTHROPIC_API_KEY` is empty or wrong. A rejected key shows "The Anthropic API key was rejected". |
| AI runs fail with "Rate limited" | Provider rate limit; wait a minute and retry smaller selections. |
| Build killed / out of memory | Server too small. Add swap or build elsewhere and push the image. |
| Imports rejected as too large | Proxy `client_max_body_size` / `max_size` is below the file size (limit 5 MB). |
| Health check is `503` | The app can't reach the database: check `DATABASE_URL`, network, and `docker compose ps db`. |
| Disk filling up | `docker system df`; prune old images with `docker image prune`; check `backups/` retention. |

When asking for help, include `docker compose ps` and the last 50 lines of `docker compose logs app migrate` (no secrets are printed).
