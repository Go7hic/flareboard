# Flareboard Features

Flareboard combines core website analytics with PostHog-like product analytics and Cloudflare-native infrastructure.

## Privacy and Trust

- Privacy-first analytics.
- Cookieless tracking by default; IP addresses are never stored.
- Data ownership: each website's events live in their own store, and self-hosters control every Cloudflare resource.
- No fingerprinting by default.
- Account security: two-factor authentication with recovery codes, session management, sign-in lockout, and audit logs for accounts and teams.

## Platform

- Edge ingest on Cloudflare Workers.
- Cloudflare stack: Workers, Queues, Durable Objects (one SQLite store per website), D1, KV, R2, and Workflows.
- Noncommercial self-hosting.
- PostHog SDK compatibility: send events from posthog-js, posthog-node, or posthog-python by changing the host and key.
- Project keys for ingestion and personal API keys (read or write scope) for the API.

## Analytics

- Website stats, realtime views, segments, custom events, and CSV export.
- People, groups, stickiness, and period comparisons.

## Reports

- Insight builder: trends with up to five series, math per series, formulas, breakdowns, and event, person, or page filters; lifecycle and stickiness.
- Funnels, retention, attribution, UTM reporting, breakdowns, web vitals, goals, cohorts, and journeys.

## Sessions and Experience

- Session replay on the Cloud and Business plans: input and text masking, blocked elements, optional console and network timelines, inactivity skipping, and share links.
- Heatmaps on the Cloud and Business plans.
- Session timelines and declarative event tracking.

## Experimentation and Feedback

- Feature flags and experiments on the Cloud and Business plans: condition groups, person, group, and cohort targeting, variants, JSON payloads, and early access.
- Multi-question surveys on the Cloud and Business plans: branching, NPS and rating scales, hosted survey links, partial responses, and CSV export.

## Quality and Observability

- Error tracking: issues, regression alerts, merging, assignment, comments, and source maps.
- OpenTelemetry (OTLP) logs and traces: search, live tail, span waterfalls, and log alerts.
- LLM analytics: generations, traces, and spans with token cost by model and user, latency percentiles, and errors; works with PostHog's LLM wrappers.

## Automation and Warehouse

- Actions, annotations, and event-triggered workflows with filters, delays, conditions, and webhook, email, or Slack steps (signed webhooks, retries, delivery log).
- Warehouse on the Cloud and Business plans: SQL over events, imported HTTP data, and Stripe, with a schema browser, saved queries, and CSV export.
- MCP server: connect Claude, Cursor, or any MCP client with a personal API key.

## Collaboration and Operations

- Teams on the Cloud and Business plans.
- Boards with board-wide filters, drag-and-drop layout, templates, and public share links with expiry.
- Insight alerts, daily or weekly email subscriptions (Cloud and Business plans), and notebooks.
- Share links, links, pixels, email reports, CSV import, revenue analytics (MRR, ARR, churn, ARPU, attribution; Stripe sync on the Cloud and Business plans), admin console, OAuth sign-in, and commercial licensing.
