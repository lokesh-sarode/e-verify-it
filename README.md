# E-Verify It

Internal admin-only email verification dashboard powered by Reacher v1 APIs.

The app supports admin login, single email verification with `POST /v1/check_email`, bulk jobs with `POST /v1/bulk`, CSV/XLSX uploads, syntax filtering, deduplication, live progress, timing counters, categorized CSV downloads, PostgreSQL persistence, Redis/BullMQ job orchestration, and Docker/Caddy deployment.

This project assumes your Reacher API already has worker/bulk processing enabled. The app does not need to run RabbitMQ or Reacher worker containers itself.

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

PowerShell:

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env`:

- Change `APP_DOMAIN` and `FRONTEND_URL`
- Change `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- Change `JWT_SECRET` and `COOKIE_SECRET`
- Set `REACHER_BASE_URL` and `REACHER_API_KEY`

Start:

```bash
docker compose up -d --build
docker compose exec api npm run prisma:migrate
docker compose exec api npm run prisma:seed
docker compose logs -f api
docker compose logs -f worker
```

Caddy serves HTTPS for `APP_DOMAIN` and proxies `/api/*` to the API service.

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

Accepted email columns:

- `email`
- `Email`
- `EMAIL`
- `emails`
- `Emails`
- `email_address`
- `Email Address`

Rows are normalized, lowercased, syntax-validated, and deduplicated before any Reacher call. Duplicate and syntax-invalid rows are tracked separately and are not sent to Reacher.

## Progress

Upload page:

- Shows upload percentage while the file is being sent
- Shows parsed row counts after job creation
- Polls the created bulk job and shows processing progress, elapsed time, and ETA

Bulk job detail page:

- Polls every 4 seconds while running
- Shows processed count, category counters, elapsed time, ETA, and records per second
- Enables downloads only when the job is completed

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

Bulk job stuck in `processing`

- Confirm `REACHER_BASE_URL` includes `/v1`.
- Confirm Reacher worker/bulk mode is enabled on your Reacher API side.
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

