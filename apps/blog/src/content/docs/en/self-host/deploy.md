---
title: Self-host Flareboard
sidebarTitle: Deploy
description: Deploy Flareboard to your own Cloudflare account, from clone to first sign-in. Covers the license, what you need, the resources to create, the config to change, and how to check the result.
---

Flareboard runs as a set of Cloudflare Workers plus D1, R2, KV, Queues and Durable Objects, all in your own Cloudflare account. This page takes you from a fresh clone to a working install.

Wherever the Cloud addresses appear in other pages (`https://flareboard.dev`, `https://api.flareboard.dev`, `https://t.flareboard.dev`), use your own dashboard, API and ingest addresses instead.

## License

Flareboard is source-available under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).

- Personal, educational and other noncommercial use is free.
- Commercial use needs a separate license. Write to [hello@flareboard.dev](mailto:hello@flareboard.dev).
- The browser SDK `@flareboard/js` is MIT-licensed and can be used on any site.

Self-hosted installs have every feature and no plan limits.

## Before you start

- A Cloudflare account. The repository's deployment guide asks for a Workers paid plan, for the Queues and D1 limits.
- A domain you can point at Workers. You need three hostnames: one each for the dashboard, the API and the ingest endpoint. This page uses `dashboard.YOUR_DOMAIN`, `api.YOUR_DOMAIN` and `t.YOUR_DOMAIN`.
- Node.js 20 or later, and pnpm 9 (the repository pins `pnpm@9.15.0`).
- A terminal where you can run `wrangler` against your account.

## How it fits together

| Part | What it does |
| --- | --- |
| Dashboard worker | Serves the console as static assets. |
| API worker | REST API, sign-in, settings, the MCP server, scheduled jobs and workflows. Exports the `EventStore` and `RateLimiter` Durable Objects. |
| Ingest worker | Receives events, replay chunks, flag and survey requests. Serves `script.js` and `recorder.js`. |
| Aggregator worker | Consumes the events queue and writes events, sessions and rollups. |
| D1 | Accounts, websites, configuration and usage. |
| Durable Objects | One SQLite-backed `EventStore` per website holds that website's analytics. `RateLimiter` limits public endpoints. |
| R2 | Session replay chunks. |
| KV | Realtime counters and an API response cache. |
| Queues | `flareboard-events` carries events from ingest to the aggregator. `flareboard-workflow-triggers` carries workflow triggers from ingest to the API. Each has a dead-letter queue. |
| Workflows | Cloudflare Workflows run workflow executions (delays, conditions, webhook, email and Slack steps) in the API worker. |

## 1. Clone and install

```bash
git clone https://github.com/Go7hic/flareboard.git
cd flareboard
pnpm install
pnpm exec wrangler login
```

## 2. Create the Cloudflare resources

Keep these names. The `wrangler.jsonc` files refer to them.

```bash
pnpm exec wrangler d1 create flareboard-db
pnpm exec wrangler kv namespace create flareboard-cache
pnpm exec wrangler r2 bucket create flareboard-replays
pnpm exec wrangler queues create flareboard-events
pnpm exec wrangler queues create flareboard-events-dlq
pnpm exec wrangler queues create flareboard-workflow-triggers
pnpm exec wrangler queues create flareboard-workflow-triggers-dlq
```

Wrangler prints the D1 `database_id` and the KV namespace `id`. Write them down for the next step. The Durable Object classes and the workflow need no separate step: `wrangler deploy` creates them.

## 3. Point the config at your resources

The `env.production` blocks in the repository contain the IDs of Flareboard's own resources and settings for the hosted service. Change them before you deploy. `pnpm validate:wrangler` only catches `REPLACE_WITH_*` placeholders, so it does not notice leftover IDs.

In `env.production` of each file:

| File | Change |
| --- | --- |
| `apps/api/wrangler.jsonc` | `d1_databases[0].database_id` to `YOUR_D1_DATABASE_ID`, `kv_namespaces[0].id` to `YOUR_KV_NAMESPACE_ID`, and the `vars` below. |
| `apps/ingest/wrangler.jsonc` | The same `database_id` and KV `id`. Set `HOSTED_MODE` as below. |
| `workers/aggregator/wrangler.jsonc` | The same `database_id`. Set `HOSTED_MODE` as below. |

Set `HOSTED_MODE` to `"false"` (or delete the line) in all three files. `"true"` turns on public sign-up, billing and plan limits, which a self-hosted install does not want. See [Configuration](/docs/self-host/configuration#hosted-mode).

In `apps/api/wrangler.jsonc`, set the production `vars` to your own addresses. Delete `STRIPE_PRICE_BUSINESS`, which is the hosted service's Stripe price.

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "EVENT_STORE": "do",
  "HOSTED_MODE": "false",
  "EMAIL_FROM": "noreply@YOUR_DOMAIN",
  "EMAIL_FROM_NAME": "Flareboard",
  "DASHBOARD_URL": "https://dashboard.YOUR_DOMAIN",
  "CORS_ORIGINS": "https://dashboard.YOUR_DOMAIN"
}
```

Keep `EVENT_STORE` at `"do"` in all three workers. They must always use the same value. `DASHBOARD_URL` and `CORS_ORIGINS` must match the dashboard origin exactly: scheme and host, no trailing slash.

## 4. Apply the database migrations

```bash
pnpm db:migrate:remote
```

It applies every file in `packages/db/migrations` to the D1 database. Run from the repository root, it is the same as:

```bash
wrangler d1 migrations apply flareboard-db --remote --env production --config apps/api/wrangler.jsonc
```

## 5. Deploy the API, aggregator and ingest

Deploy the API first. It defines the `EventStore` Durable Object class. The aggregator and ingest bind to that class through the API worker, and their deploy fails if it does not exist yet. Ingest also has a service binding to the API worker.

```bash
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

Each script checks the production configs for `REPLACE_WITH_*` placeholders, then runs `wrangler deploy --env production`. The workers are named `flareboard-api-production`, `flareboard-aggregator-production` and `flareboard-ingest-production`.

## 6. Set the secrets

`APP_SECRET` signs sessions and tracking tokens. Use the same long random value on the API and ingest workers.

```bash
cd apps/api
pnpm exec wrangler secret put APP_SECRET --env production
cd ../ingest
pnpm exec wrangler secret put APP_SECRET --env production
cd ../..
```

Without a real `APP_SECRET` the API refuses to issue sessions in production. Optional secrets (OAuth, SSO, the AI assistant) are listed in [Configuration](/docs/self-host/configuration).

## 7. Add custom domains

In the Cloudflare dashboard, open each Worker, then **Settings**, then **Domains & Routes**, and add a custom domain.

| Hostname | Worker |
| --- | --- |
| `dashboard.YOUR_DOMAIN` (or the root domain) | `flareboard-dashboard` |
| `api.YOUR_DOMAIN` | `flareboard-api-production` |
| `t.YOUR_DOMAIN` | `flareboard-ingest-production` |

The aggregator is a queue consumer and needs no hostname. The `flareboard-dashboard` worker exists after step 8, so add its domain then.

Use HTTPS everywhere. In production the session cookie is `Secure` with `SameSite=None`, so the console cannot sign in over plain HTTP.

## 8. Build and deploy the dashboard

The dashboard bakes its API and ingest addresses in at build time. Set them in the shell that runs the build:

```bash
VITE_API_URL=https://api.YOUR_DOMAIN \
VITE_INGEST_URL=https://t.YOUR_DOMAIN \
pnpm deploy:dashboard
```

Set `VITE_API_URL` explicitly. If it is missing, the console guesses `https://api.<dashboard-host>`, which is wrong for a dashboard on `dashboard.YOUR_DOMAIN`. `VITE_INGEST_URL` is required: it is never guessed, and without it the install snippet cannot send data. Do not commit these values. The other build variables are in [Configuration](/docs/self-host/configuration#dashboard-build-variables).

## 9. Create the first admin

```bash
pnpm seed:remote -- --username YOUR_ADMIN_NAME --password 'YOUR_PASSWORD'
```

A password is required, and the script refuses the development default `flareboard`. Public sign-up is off on a self-hosted install, so this is the first account. Create more accounts later: sign in, open **Admin** and click **Create user**.

## Check that it works

1. The API answers. Open or `curl` `https://api.YOUR_DOMAIN/api/heartbeat`. You should get `{"ok":true,"service":"flareboard-api","environment":"production"}`.
2. Ingest answers. `https://t.YOUR_DOMAIN/api/heartbeat` returns `{"ok":true}`. `https://t.YOUR_DOMAIN/script.js` returns JavaScript.
3. The API runs in self-hosted mode. `https://api.YOUR_DOMAIN/api/config` should contain `"hosted":false` and `"registrationEnabled":false`.
4. Open `https://dashboard.YOUR_DOMAIN` and sign in with the admin account from step 9.
5. Open **Websites**, click **Add website**, and copy the install snippet. It should point at `https://t.YOUR_DOMAIN/script.js`.
6. Install the snippet on a page, load it, and in the website's settings click **Test tracking**. Then open **Realtime**. See the [Quickstart](/docs/quickstart) from step 3 for the details.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in does nothing and the browser console shows a CORS error | `DASHBOARD_URL` and `CORS_ORIGINS` do not match the dashboard origin | Correct them in `apps/api/wrangler.jsonc` and run `pnpm deploy:api`. |
| The console says the API returned HTML instead of JSON | `VITE_API_URL` is missing or wrong, so requests hit the dashboard worker | Rebuild with the right `VITE_API_URL` (step 8). |
| The install snippet warns about a missing collection URL | The dashboard was built without `VITE_INGEST_URL` | Rebuild with it (step 8). |
| Deploying the aggregator or ingest fails on the `SITE_STORE` binding | The API worker is not deployed yet | Run `pnpm deploy:api` first. |
| Deploy fails on a database or KV binding | The `env.production` IDs still belong to someone else | Replace them (step 3). |

More on tracking problems: [Troubleshooting](/docs/troubleshooting). To update an install later, see [Upgrade](/docs/self-host/upgrade).
