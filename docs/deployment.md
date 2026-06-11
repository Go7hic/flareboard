# Deployment

Flareboard runs as four Cloudflare Workers plus D1, KV, R2, and Queues.

## Prerequisites

- Cloudflare account (Workers paid plan for Queues/D1 limits)
- Node.js 20+, pnpm 9+
- Wrangler authenticated (`wrangler login`)

## 1. Create Cloudflare resources

```bash
# D1 (shared by api, ingest, aggregator)
wrangler d1 create flareboard-db
# Note database_id — replace REPLACE_WITH_D1_ID in wrangler.jsonc production envs

pnpm db:migrate:remote
pnpm seed:remote -- --username myadmin --password 'secret'   # first admin (password required)

# KV (cache, rate limits, realtime)
wrangler kv namespace create flareboard-cache

# R2 (session replay chunks)
wrangler r2 bucket create flareboard-replays

# Queues
wrangler queues create flareboard-events
wrangler queues create flareboard-events-dlq
```

The DLQ is declared in `workers/aggregator/wrangler.jsonc`. Create it once before deploying the aggregator.

Update `REPLACE_WITH_D1_ID` and `REPLACE_WITH_KV_ID` in:

- `apps/api/wrangler.jsonc` → `env.production`
- `apps/ingest/wrangler.jsonc` → `env.production`
- `workers/aggregator/wrangler.jsonc` → `env.production`

After schema changes, run migrations. **Rollup backfill** (`pnpm backfill:rollups -- --remote`) is only needed if you import historical data from elsewhere — skip it on a fresh install.

```bash
pnpm db:migrate:remote
```

`database_id` and KV `id` in wrangler are resource identifiers, not secrets — commit them after provisioning.

## 2. Secrets

```bash
cd apps/api && wrangler secret put APP_SECRET --env production
cd apps/api && wrangler secret put SSO_SECRET --env production   # optional, for SSO
cd apps/api && wrangler secret put GOOGLE_CLIENT_ID --env production   # optional OAuth
cd apps/api && wrangler secret put GOOGLE_CLIENT_SECRET --env production
cd apps/api && wrangler secret put GITHUB_CLIENT_ID --env production
cd apps/api && wrangler secret put GITHUB_CLIENT_SECRET --env production
cd apps/api && wrangler secret put DASHBOARD_URL --env production
cd apps/api && wrangler secret put CORS_ORIGINS --env production   # e.g. https://dashboard.your-domain.com
cd ../ingest && wrangler secret put APP_SECRET --env production
```

Use the same `APP_SECRET` on API and ingest. Set `CORS_ORIGINS` to your dashboard origin(s), comma-separated.

## 3. Deploy workers

```bash
pnpm deploy:aggregator
pnpm deploy:api
pnpm deploy:ingest
pnpm deploy:dashboard
pnpm deploy:blog
```

Recommended order: aggregator → api → ingest → dashboard → blog.

| Script | Description |
|--------|-------------|
| `pnpm validate:wrangler` | Fail if production configs contain `REPLACE_WITH_*` |
| `pnpm deploy:api` | API worker |
| `pnpm deploy:ingest` | Ingest worker |
| `pnpm deploy:aggregator` | Queue consumer |
| `pnpm deploy:dashboard` | Dashboard static assets |
| `pnpm deploy:blog` | Blog static site (`/blog` on your marketing domain) |
| `pnpm backfill:rollups` | Rebuild rollup tables (`-- --remote` for production) |

## 4. Custom domains

| Host | Worker |
|------|--------|
| `dashboard.your-domain.com` or `your-domain.com/*` | Dashboard |
| `your-domain.com/blog*` | Blog (`flareboard-blog`) |
| `api.your-domain.com` | API |
| `t.your-domain.com` | Ingest (`script.js`, `/api/send`) |

In Cloudflare **Workers Routes**, add `your-domain.com/blog*` → `flareboard-blog` so the blog worker serves `/blog` while the dashboard worker handles other paths on the same hostname.

Build blog with your site URL:

```bash
PUBLIC_SITE_URL=https://flareboard.dev \
PUBLIC_MARKETING_ORIGIN=https://flareboard.dev \
pnpm deploy:blog
```

Build dashboard with your URLs:

```bash
VITE_API_URL=https://api.your-domain.com \
VITE_INGEST_URL=https://t.your-domain.com \
pnpm deploy:dashboard
```

| Variable | Required? |
|----------|-----------|
| `VITE_API_URL` | Recommended. If omitted, SPA may infer `https://api.<dashboard-host>`. |
| `VITE_INGEST_URL` | **Yes** for production tracking (not inferred). |
| `VITE_TRACKING_WEBSITE_ID` | Optional — omit when forking |

Do not commit `VITE_*` to git; set them in your build environment.

## 5. Cloudflare Git Builds

Connect the repo in Cloudflare → **Workers & Pages** → each Worker → **Builds**. Use **four separate configurations** (one per worker), all at repo root.

Before the first automated deploy: complete steps 1–2 above and run `pnpm validate:wrangler` locally.

| Service | Build command | Deploy command |
|---------|---------------|----------------|
| API | `pnpm install --frozen-lockfile && pnpm validate:wrangler && pnpm typecheck` | `pnpm --filter @flareboard/api run deploy` |
| Ingest | same | `pnpm --filter @flareboard/ingest run deploy` |
| Aggregator | same | `pnpm --filter @flareboard/aggregator run deploy` |
| Dashboard | same | `pnpm --filter @flareboard/dashboard run deploy` |

Deploying with `--env production` creates Workers named `{wrangler-name}-production` for api, ingest, and aggregator. Dashboard uses the bare name from `apps/dashboard/wrangler.jsonc`.

Set secrets on the **`-production`** Workers via `wrangler secret put --env production` or the Cloudflare dashboard — not in git or build env vars.

## Git push vs manual steps

Git push deploys **worker code only**. It does **not** run D1 migrations or create queues. Run those manually after schema or infrastructure changes:

```bash
pnpm db:migrate:remote
```

Equivalent migrate:

```bash
wrangler d1 migrations apply flareboard-db --remote --env production --config apps/api/wrangler.jsonc
```

## Post-deploy checklist

- [ ] All four workers healthy
- [ ] D1 migrations applied
- [ ] DLQ queue exists
- [ ] CORS allows dashboard → API
- [ ] Test site receives `/api/send` responses
- [ ] Login and `/api/dashboard` return 200
- [ ] Email Sending configured (see below) if using verify/reset/password or scheduled reports

## 6. Email Sending (`EMAIL` binding)

Flareboard uses Cloudflare **Email Sending** for transactional and scheduled mail. Without the binding, forgot-password, email verification, and scheduled digest workers **log messages only** — they do not deliver to inboxes.

### Required for production mail

1. Enable [Email Sending](https://developers.cloudflare.com/email-routing/email-workers/send-email/) on your zone and verify the sender domain (SPF/DKIM).
2. Confirm `send_email` binding in `apps/api/wrangler.jsonc`:

```jsonc
"send_email": [{ "name": "EMAIL" }]
```

3. Set production vars (or secrets) on the **api-production** worker:

| Variable | Example | Purpose |
|----------|---------|---------|
| `EMAIL_FROM` | `noreply@your-domain.com` | From address (must be authorized) |
| `EMAIL_FROM_NAME` | `Flareboard` | Display name |
| `DASHBOARD_URL` | `https://dashboard.your-domain.com` | Links in verify/reset/report emails |

### Features that need `EMAIL`

| Feature | Route / trigger | Notes |
|---------|-----------------|-------|
| Register verify | `POST /api/auth/register` | Verification link emailed |
| Forgot password | `POST /api/auth/forgot-password` | Reset link emailed |
| Scheduled reports | Cron `0 * * * *` on API worker | Sends when each site's `timezone` local hour is 08:00 |

### Email reports checklist

- [ ] `website_email_report` rows have valid recipient(s) and timezone
- [ ] Cron runs hourly; per-site filter uses `localHour(tz) === 8`
- [ ] Test send: enable report for one site, temporarily set timezone so local hour is 8, watch API worker logs
- [ ] Confirm digests arrive (check spam); HTML includes PV, UV, bounce, top pages/referrers

### Local development

Wrangler dev includes a `send_email` binding stub. Messages may not leave Cloudflare; check worker logs for payload. Use a verified domain in staging before go-live.
