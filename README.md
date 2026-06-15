# E-Verify It

Internal admin-only email verification dashboard powered by Reacher v1 APIs.

The app supports admin login, single email verification with `POST /v1/check_email`, bulk jobs with `POST /v1/bulk`, CSV/XLSX uploads, syntax filtering, deduplication, live progress, timing counters, categorized CSV downloads, PostgreSQL persistence, Redis/BullMQ job orchestration, and Docker/Caddy deployment.

This project assumes your Reacher API already has worker/bulk processing enabled. The app does not need to run RabbitMQ or Reacher worker containers itself.

The app uses 2 total attempts for queued bulk jobs, 2 total attempts for retryable Reacher HTTP calls, and a 15 second timeout for each outbound Reacher request by default.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, TanStack Query, Axios, React Router
- API: Node.js, TypeScript, Fastify, Zod, Prisma, PostgreSQL
- Worker: Node.js, BullMQ, Redis
- Upload parsing: `csv-parse` for CSV, `xlsx-populate` plus `jszip` XLSX sanitization for Excel
- Deployment: Docker Compose, Caddy reverse proxy

## Local Setup

PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
docker compose up -d postgres redis
npm run prisma:dev
npm run prisma:seed
npm run dev
```

Local URLs:

- Frontend: `http://localhost:5173`
- API health: `http://localhost:4000/api/health`
- API config: `http://localhost:4000/api/config`

Default local `.env.example` values use:

- PostgreSQL: `postgresql://postgres:postgres@localhost:5432/email_verifier`
- Redis: `redis://localhost:6379`
- Frontend URL: `http://localhost:5173`
- Max upload: `20 MB`

Set `REACHER_BASE_URL` to the Reacher v1 base URL, for example:

```env
REACHER_BASE_URL=https://verify.example.com/v1
REACHER_API_KEY=
```

For Reacher hosted API, set `REACHER_API_KEY`. For self-hosted Reacher, leave it empty only if your Reacher server does not require authorization.

## Docker Setup

Docker Compose now has safe local defaults and does not require `.env` just to start. For real verification, create `.env` from the Docker example and set your Reacher values:

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env`:

- Keep `APP_DOMAIN=:80` and `FRONTEND_URL=http://localhost` for Docker Desktop local testing.
- For production, change `APP_DOMAIN` and `FRONTEND_URL` to your real HTTPS domain.
- Change `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `COOKIE_SECRET`.
- Set `REACHER_BASE_URL` and `REACHER_API_KEY`.

Start:

```bash
docker compose up -d --build
docker compose logs -f api
docker compose logs -f worker
```

Open `http://localhost` for local Docker Desktop. The API container runs Prisma migrations and seeds the admin user before it starts listening. The worker waits for the API health check so it starts after migrations are ready.

Caddy serves HTTP for `APP_DOMAIN=:80`. For a real hostname, set `APP_DOMAIN=your-domain.com` and `FRONTEND_URL=https://your-domain.com`; Caddy will handle HTTPS.

If Reacher is running on your Windows host machine and the app is running in Docker, do not use `localhost` inside `REACHER_BASE_URL`. From a container, `localhost` means the container itself. Use:

```env
REACHER_BASE_URL=http://host.docker.internal:<reacher-port>/v1
```

## Reacher API Mapping

Single email verification:

- App route: `POST /api/verify/single`
- Reacher route: `POST {REACHER_BASE_URL}/check_email`
- Reacher body: `{ "to_email": "user@example.com" }`

Bulk verification:

- App route: `POST /api/bulk-jobs/upload`
- Reacher route: `POST {REACHER_BASE_URL}/bulk`
- Reacher body: `{ "input": ["a@example.com", "b@example.com"] }`
- Progress: `GET {REACHER_BASE_URL}/bulk/{job_id}`
- Results: `GET {REACHER_BASE_URL}/bulk/{job_id}/results?limit=500&offset=0`

The app stores the Reacher `job_id`, polls every `REACHER_BULK_POLL_INTERVAL_MS`, reads `total_processed`, `total_records`, `summary.total_safe`, `summary.total_invalid`, `summary.total_risky`, `summary.total_unknown`, and fetches results page by page.

## Verification Classification

Single and bulk verification both use the same backend classifier after Reacher returns a result. Syntax and MX checks are treated as filters only; they do not prove that a mailbox exists.

- `invalid`: invalid syntax, missing/unusable MX records, Reacher `is_reachable=invalid`, SMTP hard rejects, mailbox not found, mailbox disabled, unresolved mail server host, or other permanent 5xx mailbox failures.
- `risky`: catch-all domains, disposable domains, role accounts, SMTP timeouts, temporary SMTP failures, greylisting, disconnected/headless/browser SMTP errors, or other inconclusive risk signals.
- `valid`: `smtp.is_deliverable=true`, or Reacher reports `safe`/deliverable with no SMTP error.
- `unknown`: Reacher reports `unknown`, DNS has a temporary lookup failure, SMTP data is missing, or the result does not include enough evidence for valid/invalid/risky.

This means `syntax.is_valid_syntax=true` and `mx.accepts_mail=true` only allow the email to continue through verification. They are not counted as `valid` unless mailbox-level evidence is present.

## Reacher Worker Mode

The `Reacher worker mode is unavailable` error means this app reached your Reacher API, but the Reacher `/v1/bulk` endpoint rejected the job because Reacher's queue/worker architecture is not enabled.

For hosted Reacher, use `REACHER_BASE_URL=https://api.reacher.email/v1` and set `REACHER_API_KEY`; worker mode is handled by Reacher.

For self-hosted Reacher v1, enable the RabbitMQ-based worker architecture on the Reacher side, not in this app:

- Run a Reacher HTTP server.
- Run RabbitMQ.
- Run one or more Reacher worker containers.
- Configure Reacher Postgres storage for verification results.
- Set `RCH__WORKER__ENABLE=true` on Reacher worker containers.
- Set `RCH__WORKER__RABBITMQ__URL=amqp://...` on Reacher HTTP/worker containers.
- Set Reacher Postgres storage, for example `RCH__STORAGE__0__POSTGRES__DB_URL=postgresql://...` on current Reacher versions.
- Optionally set `RCH__WORKER__RABBITMQ__CONCURRENCY=5` and Reacher throttle values to control throughput.

Docs:

- `https://docs.reacher.email/self-hosting/scaling-for-production/option-2-rabbitmq-based-queue-architecture`
- `https://docs.reacher.email/self-hosting/reacher-configuration-v0.10`
- `https://docs.reacher.email/advanced/openapi/v1-bulk`

After enabling it, verify:

```bash
curl -X POST "$REACHER_BASE_URL/bulk" \
  -H "Authorization: $REACHER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"input\":[\"test@example.com\"]}"
```

The response must include `job_id`. Then `GET $REACHER_BASE_URL/bulk/{job_id}` should return `job_status`, `total_records`, and `total_processed`.

## App API Routes

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Single:

- `POST /api/verify/single`

Bulk:

- `POST /api/bulk-jobs/upload`
- `GET /api/bulk-jobs`
- `GET /api/bulk-jobs/:id`
- `GET /api/bulk-jobs/:id/progress`
- `GET /api/bulk-jobs/:id/results`
- `GET /api/bulk-jobs/:id/download/all`
- `GET /api/bulk-jobs/:id/download/valid`
- `GET /api/bulk-jobs/:id/download/invalid`
- `GET /api/bulk-jobs/:id/download/risky`
- `GET /api/bulk-jobs/:id/download/unknown`
- `GET /api/bulk-jobs/:id/download/smtp-result`
- `GET /api/bulk-jobs/:id/download/duplicates`

Admin/config:

- `GET /api/admin/stats`
- `GET /api/config`
- `GET /api/health`

## Upload Rules

- Max upload size: `MAX_UPLOAD_MB=20`
- Supported extensions: `.csv`, `.xlsx`
- CSV parser: `csv-parse/sync` with headers
- Excel parser: `xlsx-populate` reading the first sheet via `usedRange().value()`
- XLSX sanitizer: `jszip` normalizes empty inline-string cells before parsing
- Fully blank rows are ignored and are not counted as original, empty, rejected, or verification rows
- Rows with other data but no email are counted as empty rows

Accepted email columns:

- `email`
- `Email`
- `EMAIL`
- `emails`
- `Emails`
- `email_address`
- `Email Address`

Rows are normalized, lowercased, syntax-validated, and deduplicated before any Reacher call. Duplicate and syntax-invalid rows are tracked separately and are not sent to Reacher. Duplicate rows can be downloaded from the bulk job page as `duplicates.csv`, even if Reacher worker mode fails later.

## Progress

Upload page:

- Shows upload percentage while the file is being sent
- Shows parsed row counts after job creation
- Polls the created bulk job and shows processing progress, elapsed time, and ETA

Bulk job detail page:

- Polls every 4 seconds while running
- Shows processed count, category counters, elapsed time, ETA, and records per second
- Enables downloads only when the job is completed
- Enables duplicate download as soon as duplicates are known

## Troubleshooting

`[vite] http proxy error: /api/auth/login` or `ECONNREFUSED`

- The frontend is running, but the API is not reachable at `http://localhost:4000`.
- Run `npm run dev` from the repo root, not only the frontend workspace.
- Check `http://localhost:4000/api/health`.
- Check that PostgreSQL and Redis are running: `docker compose up -d postgres redis`.
- Check `.env` uses local URLs for local dev.

`FATAL ERROR: Reached heap limit`

- The old dev script used `tsx watch` for API/worker. It has been changed to plain `tsx` to avoid monorepo watch memory pressure.
- Pull the latest code, run `npm install`, then run `npm run dev`.

`Request failed with status code 500` on upload

- The API now returns specific messages for bad file type, oversized file, parse errors, and Redis queue failures.
- Confirm file size is under 20 MB.
- Confirm the file has one accepted email column.
- Confirm Redis is running and `REDIS_URL` is correct.
- Check `docker compose logs -f worker` or the local worker terminal.

`Transaction already closed` during bulk upload

- Bulk job creation no longer stores all upload rows inside one Prisma interactive transaction.
- Pull the latest code, rebuild the API, and restart the worker/API.
- For Docker Desktop, run `docker compose up -d --build`.

Single verification returns `fetch failed`

- The API now returns a clearer Reacher configuration or network message.
- Confirm `REACHER_BASE_URL` is not the placeholder `https://verify.example.com/v1`.
- Confirm `REACHER_BASE_URL` includes `/v1`.
- If the app runs in Docker and Reacher runs on your host machine, use `http://host.docker.internal:<reacher-port>/v1`, not `http://localhost:<reacher-port>/v1`.
- If Reacher is hosted elsewhere, confirm the container can reach it and that `REACHER_API_KEY` is correct.

Bulk job stuck in `processing`

- Confirm `REACHER_BASE_URL` includes `/v1`.
- Confirm Reacher worker/bulk mode is enabled on your Reacher API side.
- For self-hosted Reacher v1, confirm `RCH__WORKER__ENABLE=true`, `RCH__WORKER__RABBITMQ__URL`, and Reacher Postgres storage are configured.
- Confirm `POST {REACHER_BASE_URL}/bulk` returns a `job_id`.
- Confirm `GET {REACHER_BASE_URL}/bulk/{job_id}` returns `job_status`, `total_records`, and `total_processed`.

Login fails

- Run `npm run prisma:seed` after changing `ADMIN_EMAIL` or `ADMIN_PASSWORD`.
- Confirm `DATABASE_URL` points to the database you migrated.
- Confirm cookies are allowed for the frontend domain.

## Useful Commands

```bash
npm install
npm run dev
npm run build
npm run prisma:generate
npm run prisma:dev
npm run prisma:migrate
npm run prisma:seed
docker compose up -d --build
docker compose logs -f api
docker compose logs -f worker
```
