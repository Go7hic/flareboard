---
title: Flareboard vs PostHog
description: PostHog-style product analytics on Cloudflare, without ClickHouse, Kafka or Kubernetes. What matches, where PostHog is still ahead, and how to switch.
pubDate: 2026-07-06
updatedDate: 2026-10-03
author: Flareboard
tags:
  - posthog
  - product-analytics
  - cloudflare
  - comparison
---

[PostHog](https://posthog.com) set the bar for product analytics in one place: events, funnels, feature flags, experiments, session replay, error tracking and warehouse queries. Flareboard targets the same kind of product for teams that would rather not operate an analytics cluster, or that already build on Cloudflare.

## Same product shape, different data plane

| Topic | PostHog | Flareboard |
| --- | --- | --- |
| Hosting | PostHog Cloud, or self-hosted on ClickHouse, Kafka and Postgres | Flareboard Cloud, or self-hosted on your Cloudflare account |
| Storage | A shared ClickHouse cluster | One SQLite database per website, in a Durable Object |
| Deploy path for self-hosting | Docker or Kubernetes | Wrangler deploys to Workers |
| Pricing | Usage-based per product, with a free monthly allowance for each | Free plan, then $19 or $99 per month with event and replay allowances |

Flareboard is not a PostHog clone. It covers the core of PostHog's product on a different architecture, and it is a much younger product.

## What Flareboard includes

- **Product analytics.** Events, sessions, realtime, funnels, journeys, retention, stickiness, cohorts, people and groups, UTM, attribution, revenue and Web Vitals.
- **Replay and heatmaps.** Recordings stored in R2 with inputs masked by default.
- **Flags and experiments.** Targeting rules, rollouts, variants and payloads; experiments with frequentist and Bayesian results.
- **Surveys and workflows.** NPS, CSAT and open-text surveys; workflows with delays, branches, webhooks, email and Slack.
- **Quality.** Error issues with source maps and alerts, OpenTelemetry logs and traces, LLM cost and latency.
- **Data access.** Read-only SQL over your events, a Stripe import for revenue, and an MCP server for AI tools.

Privacy defaults are cookieless: visitors are counted with a hash whose salt changes every month, and IP addresses are never stored.

## Where PostHog is still ahead

- **Scale and track record.** PostHog has run very large workloads for years. Flareboard is new.
- **Data pipelines.** PostHog has a large catalog of sources and destinations. Flareboard imports from Stripe and HTTP and offers read-only SQL, but not general ETL.
- **People tooling.** Flareboard has identify, alias and person profiles, but no UI for merging duplicate people yet.
- **SDK coverage.** PostHog maintains SDKs for many platforms. Flareboard has its own browser SDK and accepts events from PostHog's SDKs, but has no native mobile SDKs of its own.

If you need PostHog's whole catalog today, PostHog is the safer choice.

## When Flareboard is the better fit

1. You build on Cloudflare and want analytics in the same platform, deployed with Wrangler.
2. You want to self-host for noncommercial use without running ClickHouse and Kafka.
3. You want each website's data in its own database, so a busy site never slows another one down.
4. You prefer a small set of fixed monthly plans over per-product usage pricing.

## Switching

PostHog's SDKs can send to Flareboard if you change two settings, the API key and the host. The [compatibility guide](/docs/install/posthog) covers what is supported, including pageviews, custom events, identify, groups and feature flag calls. Many teams run both in parallel during an evaluation.

- [Open the live demo](https://flareboard.dev/demo)
- [Full comparison grid](https://flareboard.dev/compare)
- [Start free on Flareboard Cloud](https://flareboard.dev/register)
