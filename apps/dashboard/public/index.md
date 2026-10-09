# Flareboard

> Flareboard is a PostHog-like product analytics platform built on Cloudflare Workers, Durable Objects, D1, R2, KV, Queues, and Workflows. It accepts events from PostHog SDKs.

## What It Does

Flareboard provides privacy-friendly analytics, realtime session visibility, event catalogs, an insight builder, session replay, heatmaps, feature flags, experiments, surveys, error tracking, OpenTelemetry logs and traces, LLM analytics, workflows, revenue analytics, and a SQL warehouse. AI tools can query it through an MCP server.

## Who It Is For

Flareboard is for product teams, developers, and Cloudflare-oriented builders who want hosted or self-hostable product analytics with a Cloudflare-native data plane, including teams moving off PostHog who want to keep their existing SDK code.

## Core Features

- Website stats, realtime analytics, segments, custom events, and CSV export.
- Insight builder: trends with up to five series, formulas, breakdowns, and event, person, or page filters; funnels, retention, lifecycle, and stickiness.
- Attribution, UTM breakdowns, web vitals, goals, cohorts, and journeys.
- Session replay with masking, console and network timelines, and share links; heatmaps and session timelines.
- Feature flags with condition groups and payloads, experiments, and multi-question surveys.
- Error tracking with issues, regressions, and source maps; OpenTelemetry (OTLP) logs and traces; LLM analytics with token cost per model and user.
- Workflows with webhook, email, and Slack steps; a SQL warehouse with a Stripe connector; MRR and revenue analytics.
- Boards with filters, alerts, email subscriptions, notebooks, teams, share links, and an MCP server.
- PostHog SDK compatibility (posthog-js, posthog-node, posthog-python), project keys, and personal API keys.
- Two-factor authentication, session management, and audit logs.

## Pricing Summary

The Free Cloud plan includes one website, 100K events and 50K OpenTelemetry log records and spans per month, raw data kept up to 1 year, and core product analytics. The Cloud plan is $19/month with unlimited websites, 1M events, 5K session replays and 500K log records and spans per month pooled across those sites (collection continues up to 20% over each allowance, then pauses until the next month), raw data kept up to 2 years, replay, heatmaps, teams, email reports and subscriptions, CSV import/export, feature flags, experiments, surveys, and the warehouse (including Stripe sync). The Business plan is $99/month with the same features as Cloud, 5M events, 25K session replays and 5M log records and spans per month, and raw data kept up to 3 years.

## Try or Self-Host

- Hosted app: https://flareboard.dev/
- Pricing: https://flareboard.dev/pricing
- GitHub: https://github.com/Go7hic/flareboard
- Documentation: https://flareboard.dev/docs (Markdown index for agents: https://flareboard.dev/docs/llms.txt)
- Self-hosting guide: https://flareboard.dev/docs/self-host/deploy
