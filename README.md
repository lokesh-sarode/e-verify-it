# E-Verify It

Internal admin-only email verification dashboard powered by Reacher. It supports single email checks, bulk CSV/XLSX uploads, syntax filtering, deduplication, progress polling, categorized downloads, PostgreSQL persistence, Redis/BullMQ processing, and Docker/Caddy deployment on a Hostinger Ubuntu VPS.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, TanStack Query, Axios, React Router
- API: Node.js, TypeScript, Fastify, Zod, Prisma, PostgreSQL
- Worker: Node.js, BullMQ, Redis
- Deployment: Docker Compose, Caddy reverse proxy, optional RabbitMQ and Reacher worker services

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:dev
npm run prisma:seed
npm run dev
```

Local services expected by default:

- PostgreSQL at `postgresql://postgres:postgres@localhost:5432/email_verifier`
- Redis at `redis://localhost:6379`
- Reacher at `REACHER_BASE_URL`

## Production Setup on Hostinger Ubuntu VPS

1. Install Docker and the Docker Compose plugin.
2. Point your domain DNS A record to the VPS public IP.
3. Copy `.env.example` to `.env` and replace secrets, admin credentials, domains, and Reacher settings.
4. Build and start services:

```bash
docker compose up -d --build
docker compose exec api npm run prisma:migrate
docker compose exec api npm run prisma:seed
docker compose logs -f api
docker compose logs -f worker
```

Caddy automatically requests HTTPS certificates for `APP_DOMAIN`.

## Reacher Configuration

Set:

```env
REACHER_BASE_URL=https://verify.example.com/v1
REACHER_API_KEY=
REACHER_WORKER_MODE_ENABLED=true
REACHER_RABBITMQ_URL=amqp://rabbitmq:5672
```

When `REACHER_API_KEY` is present, the API sends it as:

```http
Authorization: <REACHER_API_KEY>
```

The backend never exposes this key to the frontend.

## Bulk Verification Modes

Mode A uses Reacher native bulk:

- `POST {REACHER_BASE_URL}/bulk`
- `GET {REACHER_BASE_URL}/bulk/{job_id}`
- `GET {REACHER_BASE_URL}/bulk/{job_id}/results`

Mode B is the local BullMQ fallback:

- Triggered when Reacher bulk returns worker-mode unavailable or HTTP 503
- Uses `/check_email` with `BULK_CONCURRENCY`
- Rate-limited by `REACHER_REQUESTS_PER_SECOND`
- Retries temporary Reacher errors with exponential backoff

To run optional Reacher worker services from this Compose file:

```bash
docker compose --profile reacher up -d --build
docker compose --profile reacher logs -f rabbitmq reacher-api reacher-worker
```

Confirm the Reacher API and worker logs show RabbitMQ connectivity before starting large jobs.

## File Uploads

Supported files:

- `.csv`
- `.xlsx`

Accepted email columns:

- `email`
- `Email`
- `EMAIL`
- `emails`
- `Emails`
- `email_address`
- `Email Address`

The API normalizes emails, removes empty rows, rejects invalid syntax before Reacher calls, deduplicates within the file, and stores rejected row counts.

## Downloads

CSV endpoints:

- `GET /api/bulk-jobs/:id/download/all`
- `GET /api/bulk-jobs/:id/download/valid`
- `GET /api/bulk-jobs/:id/download/invalid`
- `GET /api/bulk-jobs/:id/download/risky`
- `GET /api/bulk-jobs/:id/download/unknown`
- `GET /api/bulk-jobs/:id/download/smtp-result`

## Security

- Admin login only; no public signup
- Passwords hashed with bcrypt
- JWT stored in an httpOnly cookie
- CORS allowlist via `FRONTEND_URL`
- Helmet security headers
- Rate limiting on API and login
- Zod validation on request bodies
- CSV/XLSX-only upload validation
- Reacher API key is server-only

## Useful Commands

```bash
npm install
npm run dev
npm run build
npm run prisma:migrate
npm run prisma:seed
docker compose up -d --build
docker compose logs -f api
docker compose logs -f worker
```

## Troubleshooting

- Reacher returns worker-mode errors: start the `reacher` profile or set `REACHER_WORKER_MODE_ENABLED=false` to use local fallback mode.
- Upload says missing column: rename the email column to one of the accepted aliases.
- Redis unavailable: check `docker compose logs redis` and `REDIS_URL`.
- Database unavailable: check `docker compose logs postgres` and `DATABASE_URL`.
- Login fails after changing `.env`: run `npm run prisma:seed` or `docker compose exec api npm run prisma:seed`.

