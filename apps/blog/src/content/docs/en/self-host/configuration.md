---
title: Configuration
description: Every variable, secret and build setting for a self-hosted Flareboard, per worker, with defaults. Also how to set up email, Google and GitHub sign-in, SSO and the AI assistant.
---

This page lists the settings of each Flareboard worker. For the first deployment, follow [Self-host Flareboard](/docs/self-host/deploy) and come back here for the optional parts.

## How settings are applied

- **Variables** go in the `vars` block of `env.production` in the worker's `wrangler.jsonc`. They are plain text. Deploy the worker again to apply a change.
- **Secrets** are set with `wrangler secret put NAME --env production`, run inside the worker's directory (`apps/api`, `apps/ingest`). They are not stored in git.
- **Dashboard settings** are `VITE_*` variables read when the dashboard is built. They are not wrangler variables.
- **Local development** reads `apps/api/.dev.vars` and `apps/ingest/.dev.vars`. Copy them from `.dev.vars.example`.

Do not set the same name as both a variable and a secret.

## API worker

Deployed as `flareboard-api-production`.

| Name | Kind | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `APP_SECRET` | secret | Yes | none | Signs sessions and tracking tokens. Use the same value on the ingest worker. In production the API refuses to start sessions without it. |
| `ENVIRONMENT` | variable | Yes | `development` at the top level, `production` in `env.production` | `production` turns on the HSTS header and a `Secure`, `SameSite=None` session cookie, removes the localhost CORS origins, and keeps email links out of the logs. |
| `EVENT_STORE` | variable | Yes | `do` in the repository config | Where analytics are stored. See [Event store](#event-store). |
| `HOSTED_MODE` | variable | No | unset (off) | `"true"` is for running Flareboard as a paid service. See [Hosted mode](#hosted-mode). |
| `DASHBOARD_URL` | variable | Yes | none | Public dashboard origin. Allowed as a CORS origin, and used for links in verification, reset, report and alert emails and for the redirect after OAuth sign-in. |
| `CORS_ORIGINS` | variable | No | none | More comma-separated dashboard origins allowed to call the API with credentials (`DASHBOARD_URL` is always allowed). Exact match, no trailing slash. |
| `SHARE_URL` | variable | No | none | Fallback for `DASHBOARD_URL` in sign-in redirects and billing links. Also reported by `/api/config`. |
| `EMAIL_FROM` | variable | For email | `noreply@flareboard.dev` | Sender address. Its domain must be set up for Email Sending. Change it: the default is the hosted service's address. |
| `EMAIL_FROM_NAME` | variable | No | `Flareboard` | Sender display name. |
| `SSO_SECRET` | secret | For SSO | none | HMAC secret for `POST /api/auth/sso`. See [Single sign-on](#single-sign-on). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | For Google sign-in | none | Both are needed to enable the provider. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | secrets | For GitHub sign-in | none | Both are needed to enable the provider. |
| `DEEPSEEK_API_KEY` | secret | For the assistant | none | Turns on Ask Flareboard. Unset means the assistant is off. |
| `DEEPSEEK_MODEL` | variable | No | `deepseek-flash` | Model used by the assistant. |
| `DEEPSEEK_BASE_URL` | variable | No | `https://api.deepseek.com/anthropic` | DeepSeek endpoint (Anthropic message format). |
| `DEMO_DATA` | variable | No | on | `off` stops the generator that fills the built-in sample websites (hourly job and admin backfill). |
| `DEMO_WEBSITE_ID` | variable | No | none | Website shown by the public `/demo` console. Overrides the share link with the slug `demo`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CLOUD`, `STRIPE_PRICE_BUSINESS` | secrets and a variable | Hosted only | none | Billing for hosted mode. Leave unset on a self-hosted install. |

The API worker also runs an hourly job (`0 * * * *`). It sends scheduled email reports, checks alert rules and error regressions, runs saved warehouse queries and data source syncs, purges data past each website's retention setting, and erases websites and accounts deleted more than 30 days ago.

## Ingest worker

Deployed as `flareboard-ingest-production`.

| Name | Kind | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `APP_SECRET` | secret | Yes | none | Must equal the API worker's value. |
| `ENVIRONMENT` | variable | Yes | `development` at the top level, `production` in `env.production` | Environment name. |
| `EVENT_STORE` | variable | Yes | `do` | Must equal the API worker's value. |
| `HOSTED_MODE` | variable | No | unset (off) | Must equal the API worker's value. When `"true"`, ingest enforces plan allowances. |
| `API_URL` | variable | No | `http://localhost:8788` | Local development fallback for calls to the API. Production uses the `API` service binding to `flareboard-api-production`. |
| `PROJECT_KEY_RATE_LIMIT` | variable | No | `30000` | Requests per minute allowed for each project key. |
| `DEMO_INGEST` | variable | No | unset | `on` lets a hosted-mode ingest accept traffic for the built-in sample websites. Only matters with `HOSTED_MODE` on. |

## Aggregator worker

Deployed as `flareboard-aggregator-production`. It has no secrets.

| Name | Kind | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `EVENT_STORE` | variable | Yes | `do` | Must equal the API worker's value. |
| `HOSTED_MODE` | variable | No | unset (off) | Must equal the API worker's value. When `"true"`, billable events update monthly usage. |

## Dashboard build variables

The dashboard is static. These variables are read by `vite build`, so set them in the shell or in your Cloudflare build environment, then deploy again. Do not commit them.

| Name | Required | Default | What it does |
| --- | --- | --- | --- |
| `VITE_API_URL` | Recommended | `https://api.<dashboard-host>`, with a leading `www.` removed | API origin. Set it whenever the API is not at `api.` plus the dashboard's own host. |
| `VITE_INGEST_URL` | Yes | none | Ingest origin used in the install snippet. Never guessed. |
| `VITE_TRACKING_WEBSITE_ID` | No | none | Website ID for the dashboard to track itself. Leave unset on a self-hosted install. |
| `VITE_SITE_URL` | No | `https://flareboard.dev` | Public dashboard origin for canonical and social-preview URLs. Set it to your dashboard address. |
| `VITE_MAP_STYLE_URL` | No | CARTO Voyager | Map style URL for the world map. |
| `VITE_DISABLE_MAPLIBRE_GLOBE` | No | unset | `true` uses the older globe renderer instead of MapLibre. |

The optional blog and docs site (`apps/blog`) reads `PUBLIC_SITE_URL` and `PUBLIC_MARKETING_ORIGIN` at build time. A self-hosted install does not need it.

## Bindings

These are set in `wrangler.jsonc`. You only change them to point at your own resources.

| Worker | Bindings |
| --- | --- |
| API | `DB` (D1 `flareboard-db`), `CACHE` (KV), `REPLAY_BUCKET` (R2 `flareboard-replays`), `RATE_LIMITER` and `SITE_STORE` (Durable Objects `RateLimiter` and `EventStore`), `EMAIL` (Email Sending), `WORKFLOW_RUNNER` (Workflow). Consumes `flareboard-workflow-triggers`. |
| Ingest | `DB`, `CACHE`, `REPLAY_BUCKET`, `RATE_LIMITER`, `SITE_STORE` (the API worker's `EventStore`), `EVENT_QUEUE` (`flareboard-events`), `WORKFLOW_QUEUE` (`flareboard-workflow-triggers`), `API` (service binding to the API worker). |
| Aggregator | `DB`, `SITE_STORE` (the API worker's `EventStore`), `DLQ` (`flareboard-events-dlq`). Consumes `flareboard-events` and its dead-letter queue. |

## Hosted mode

`HOSTED_MODE` is `"true"` only for the paid Flareboard Cloud service. A self-hosted install leaves it off, which gives you:

- No public sign-up. `POST /api/auth/register` answers 404 and `/api/config` reports `"registrationEnabled":false`. An admin creates accounts under **Admin**.
- No billing, plan limits or usage emails. Every feature is available.
- No email verification step at sign-in.
- Raw-data retention only for websites where a retention period is set. Without one, data is kept.
- Google and GitHub sign-in cannot create accounts. See [Sign in with Google or GitHub](#sign-in-with-google-or-github).

Set the same value on the API, ingest and aggregator workers.

## Event store

`EVENT_STORE` chooses where analytics are written and read. The API, ingest and aggregator workers must always use the same value.

| Value | Writes | Reads |
| --- | --- | --- |
| `do` | One `EventStore` Durable Object per website | The website's store |
| `dual` | D1, then the website's store | D1 |
| `d1` | D1 | D1 |

Use `do` on a new install. `d1` is the legacy mode and is what the code falls back to when the variable is unset or has any other value. `dual` exists for moving an older install from D1 to Durable Objects: while it is on, the API's hourly job copies history to the stores.

## Email

Flareboard sends mail through Cloudflare Email Sending. It is used for password reset links, scheduled email reports, usage and alert notices, and the email step of workflows.

1. Enable [Email Sending](https://developers.cloudflare.com/email-routing/email-workers/send-email/) on your domain and verify the sender domain (SPF and DKIM).
2. Keep the `send_email` binding named `EMAIL` in `apps/api/wrangler.jsonc`.
3. Set `EMAIL_FROM` (and optionally `EMAIL_FROM_NAME`) to an address on that domain, and `DASHBOARD_URL` so links in the mail point at your dashboard.
4. Deploy the API worker.

Without the `EMAIL` binding nothing is delivered. In production the API logs only that a message could not be sent, never the message or its link.

## Sign in with Google or GitHub

1. Create an OAuth app with the provider. Use this callback URL, with your API host:
   - Google: `https://YOUR_API_HOST/api/auth/oauth/google/callback`
   - GitHub: `https://YOUR_API_HOST/api/auth/oauth/github/callback`
2. Set the provider's two secrets on the API worker:

   ```bash
   cd apps/api
   pnpm exec wrangler secret put GITHUB_CLIENT_ID --env production
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env production
   ```

   For Google use `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. The sign-in page then offers **Sign in with GitHub** or **Sign in with Google**. A provider is enabled only when both of its secrets are set.

On a self-hosted install a provider signs in existing accounts only. It works for an account that already linked the provider, or whose email is verified and matches the provider's verified email. A signed-in user links a provider from the **Sign-in methods** section of their account security page. New accounts are not created from OAuth unless `HOSTED_MODE` is on.

## Single sign-on

SSO lets another system sign users in without a password, using a short-lived signed token.

1. Set the secret. Use a value different from `APP_SECRET`:

   ```bash
   cd apps/api
   pnpm exec wrangler secret put SSO_SECRET --env production
   ```

2. From a script in the repository, mint a token for an existing user. It expires after 5 minutes.

   ```ts
   import { createSsoToken } from '@flareboard/shared';

   const token = createSsoToken({ userId: 'USER_ID', role: 'user' }, process.env.SSO_SECRET!);
   console.log(token);
   ```

3. Exchange it for a session. The response has the same shape as sign-in and includes `token` and `user`.

   ```bash
   curl -X POST https://api.YOUR_DOMAIN/api/auth/sso \
     -H 'Content-Type: application/json' \
     -d '{"token":"YOUR_SSO_TOKEN"}'
   ```

Without `SSO_SECRET` in production the endpoint answers 503 `SSO is not configured`.

## AI assistant

Ask Flareboard answers questions about a website's data. Set the key to turn it on:

```bash
cd apps/api
pnpm exec wrangler secret put DEEPSEEK_API_KEY --env production
```

Without the key the assistant is off. It calls DeepSeek. What you ask, the website's name, domain and timezone, and the data the assistant looks up are sent to DeepSeek, stored in China, and may be used by DeepSeek to improve its models. Decide whether that fits your privacy requirements before enabling it. On a self-hosted install there is no daily question limit.

## Billing

Stripe settings (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CLOUD`, `STRIPE_PRICE_BUSINESS`) belong to hosted mode. With `HOSTED_MODE` off, the billing endpoints answer 404 `Billing is not enabled`. Leave them unset.

Connecting Stripe as a data source for revenue reports is a separate feature. Its restricted key is entered in the console, stored encrypted, and is not an environment variable.

## Local development

Local runs use `.dev.vars` files:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/ingest/.dev.vars.example apps/ingest/.dev.vars
```

The example sets `HOSTED_MODE=false`. Use the same `APP_SECRET` in both files. The dashboard needs no `.env` in development: its dev server forwards `/api/` to the API worker on `http://localhost:8788`, and the install snippet uses `http://localhost:8787` for ingest.
