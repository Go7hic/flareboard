# Flareboard

Product analytics that runs entirely on Cloudflare: website analytics, session replay, feature
flags, experiments, surveys, error tracking, logs and LLM observability in one place, without
ClickHouse or Kubernetes. A PostHog-like product surface on Workers, Durable Objects, D1, R2, KV
and Queues.

**[flareboard.dev](https://flareboard.dev)** · [Docs](https://flareboard.dev/docs) · [Live demo](https://flareboard.dev/demo) ·
[Pricing](https://flareboard.dev/pricing) · [Blog](https://flareboard.dev/blog) ·
[`@flareboard/js` on npm](https://www.npmjs.com/package/@flareboard/js)

## Product

- **Product analytics:** overview, events, actions, sessions, realtime, funnels, journeys,
  retention, stickiness, people and groups, segments, cohorts, UTM, attribution, revenue (with
  Stripe MRR), Web Vitals at p75, insights, boards, notebooks and reports.
- **Session replay and heatmaps:** rrweb replays stored in R2 with inputs masked by default,
  saved and shared replays, click and scroll heatmaps.
- **Feature flags and experiments:** targeting rules, rollouts, variants and payloads, flag-linked
  experiments with frequentist and Bayesian results.
- **Surveys and workflows:** NPS, CSAT and open feedback surveys; event-triggered workflows with
  delays, branches, webhooks, email and Slack.
- **Errors, logs and traces:** error issues with source maps and alerts, OpenTelemetry (OTLP) logs
  and traces, AI / LLM observability (cost, tokens, latency, traces).
- **For teams and agents:** "Ask Flareboard" assistant, an [MCP server](docs/mcp.md), read-only SQL
  over your data, teams and roles, SSO, audit log and personal API keys.

Privacy: cookieless by default (a monthly-salted hash of IP and user agent; IPs are never stored),
autocapture never records field values.

## Add it to a site

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

Or with npm (typed, with React hooks for feature flags) — see the
[`@flareboard/js` README](packages/sdk-js/README.md):

```bash
npm install @flareboard/js
```

PostHog SDKs can send to Flareboard too: [PostHog compatibility](docs/ingest-posthog-compat.md).

## Architecture

| Component | Dev port | Role |
|-----------|----------|------|
| `apps/ingest` | 8787 | Tracking: `/script.js`, `/api/send`, replay, OTLP logs and traces, PostHog-compatible capture, short links and pixels |
| `apps/api` | 8788 | Authenticated REST API, MCP server, scheduled jobs (alerts, retention, deletion) |
| `workers/aggregator` | — | Queue consumer: writes events to each website's store, keeps rollups and monthly usage |
| `apps/dashboard` | 5173 | React dashboard (Vite, shadcn/Base UI, Geist) |
| `apps/blog` | — | Astro blog |
| `packages/sdk-js` | — | `@flareboard/js` browser SDK |

**Storage:** every website's analytics (events, sessions, people, logs, spans, rollups) lives in
its own SQLite-backed Durable Object; D1 holds accounts, websites, configuration and usage; R2
stores replay recordings; KV caches realtime counters and API responses; Queues absorb ingest
spikes. Shared packages: `@flareboard/db`, `@flareboard/shared`, `@flareboard/rate-limiter`.

## Local development

Requires Node.js 20+ and pnpm 9+.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/ingest/.dev.vars.example apps/ingest/.dev.vars
pnpm db:migrate
pnpm seed
```

Then run each in its own terminal:

```bash
pnpm dev:api        # :8788
pnpm dev:ingest     # :8787
pnpm dev:dashboard  # :5173
pnpm dev:aggregator
```

Open http://localhost:5173 and sign in with the credentials `pnpm seed` prints
(`scripts/seed.ts --help` for overrides). `pnpm typecheck` and `pnpm test` cover every package.

## Deploy

Production setup (Cloudflare resources, secrets, custom domains): **[Self-hosting guide](https://flareboard.dev/docs/self-host/deploy)** (repository copy: [docs/deployment.md](docs/deployment.md)).
Forkers: replace the D1, KV, R2, Queues and Durable Object bindings in each app's
`wrangler.jsonc` with your own resources before deploying.

## Docs

| | |
|---|---|
| [Development](docs/development.md) | Local dev, scripts, smoke tests |
| [API reference](docs/api.md) | REST and ingest endpoints |
| [Tracking and ingest](docs/ingest.md) | Endpoints, payloads, tracker script, recorder, flags, surveys |
| [PostHog compatibility](docs/ingest-posthog-compat.md) | Sending from PostHog SDKs |
| [Logs and traces](docs/logs-otlp.md) | OpenTelemetry (OTLP) ingest |
| [LLM observability](docs/llm-observability.md) | AI generations, cost and traces |
| [MCP server](docs/mcp.md) | Flareboard tools for AI agents |
| [SSO](docs/sso.md) | Single sign-on |
| [Dashboard design system](docs/dashboard-design-system.md) | Console UI rules |
| [Database](packages/db/README.md) | Schema and migrations |
| [Security](SECURITY.md) | Vulnerability reporting |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal, educational, and other
noncommercial use. Commercial use requires separate permission from the copyright holders.

The browser SDK [`@flareboard/js`](packages/sdk-js) is [MIT-licensed](packages/sdk-js/LICENSE),
so you can add it to any site, commercial or not. Using the hosted service at flareboard.dev is
covered by its [Terms of Service](https://flareboard.dev/terms).
