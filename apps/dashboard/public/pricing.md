# Flareboard Pricing

Flareboard Cloud has a Free plan and a Cloud plan. Self-hosting is available for personal and noncommercial use without a Cloud subscription. Commercial licensing is separate from the hosted Cloud subscription.

## Plans

| Plan | Price | Websites | Events per month | Session replays per month | Log records and spans per month | Raw data retention | Best for |
| --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| Free | $0/month | 1 | 100K | Not included | 1M | Up to 1 year | Core product analytics for one site |
| Cloud | $15/month | Unlimited | 1M | 5K | 10M | Up to 3 years | Teams that need replay, heatmaps, data portability, product workflows, and a higher event pool |

Cloud websites are unlimited and share one set of monthly allowances. Free remains one website.

## What counts toward the allowances

Events: pageviews, custom events, errors, browser logs sent with `flareboard.log`, AI events, web vitals, revenue events, and heatmap clicks/scrolls. Session metadata, identify updates, feature-flag evaluations, and survey ingest do not count.

Session replays: one per recording, counted when its first chunk arrives. A recording already under way when the allowance runs out still finishes.

Log records and spans: each OpenTelemetry log record and span sent to `/v1/logs` or `/v1/traces`, counted separately from events.

## Going over an allowance

Allowances reset on the first day of each month (UTC). The account owner gets an email at 80% and 100% of each allowance, and when collection stops.

- Free: collection of that kind of data stops at the allowance until the next month.
- Cloud: collection continues up to 2× the allowance, then stops until the next month. There are no automatic overage charges.

## Data retention

Raw data (events, session replays, logs and traces) is kept for up to 1 year on Free and up to 3 years on Cloud. Each website can set a shorter period; older raw data is deleted automatically. OpenTelemetry logs and traces are kept for 30 days at most.

## Included in Both Plans

- Core analytics.
- Realtime views.
- Segments and custom events.
- Funnels, retention, attribution, web vitals, goals, cohorts, journeys, people, groups, stickiness, revenue tracking, share links, boards, links, and pixels.
- Insight builder, error tracking, OpenTelemetry logs and traces, LLM analytics, workflows, notebooks, insight alerts, PostHog SDK compatibility, API keys, an MCP server, and two-factor authentication.

## Cloud Plan Capabilities

- Session replay.
- Heatmaps.
- Teams.
- Email reports and board or insight subscriptions.
- CSV import and export.
- Feature flags and experiments.
- Surveys.
- Warehouse SQL with the Stripe connector.

## Self-Hosting and Commercial Licensing

Personal and noncommercial self-hosting is available without a hosted Cloud subscription. Commercial organizations using Flareboard commercially can purchase a license separately. Deployment assistance, migration, updates, and support are also available on request.

Official pricing page: https://flareboard.dev/pricing
