---
title: Flareboard vs Umami
description: Umami is excellent privacy-friendly web analytics, now with replays and heatmaps. Flareboard adds feature flags, experiments, surveys, error tracking and logs, and runs on Cloudflare.
pubDate: 2026-07-08
updatedDate: 2026-10-03
author: Flareboard
tags:
  - umami
  - product-analytics
  - cloudflare
  - comparison
---

[Umami](https://umami.is) is one of the best privacy-focused analytics tools around. It is fast, simple and easy to self-host, and it has grown well past traffic dashboards: recent versions add funnels, journeys, retention, goals, UTM, revenue and attribution reports, plus session replays and heatmaps.

Flareboard starts from a similar place, cookieless analytics with first-party ingest, and goes further into product work: feature flags, experiments, surveys, error tracking, logs and LLM observability, all on the same event stream.

## Side by side

| Use case | Umami | Flareboard |
| --- | --- | --- |
| Pageviews, referrers, realtime | Yes | Yes |
| Funnels, journeys, retention, goals | Yes | Yes, plus stickiness and account groups |
| Session replay and heatmaps | Yes | Yes, on paid plans |
| Feature flags and experiments | No | Yes |
| Surveys | No | Yes |
| Error tracking, logs and traces | No | Yes |
| Built-in SQL editor | No | Yes, read-only |
| Where it runs | A Node app with PostgreSQL | Cloudflare Workers and Durable Objects |

If you only need analytics reports, both tools do the job. Flareboard is worth a look when you also run flags, experiments or error tracking as separate products and want them on the same events.

## Moving from Umami

You don't have to rewrite your tracking:

- `data-umami-event` attributes keep working. The Flareboard tracker reads them next to its own `data-flareboard-event` attributes, including the `-event-<property>` extras.
- The privacy model is similar. Flareboard sets no cookies, never stores IP addresses and counts visitors with a hash whose salt changes every month.
- You can run both side by side while you compare numbers.

## Infrastructure

Umami usually runs as a Node app with a PostgreSQL database on a server or container platform.

Flareboard runs on Cloudflare:

- An ingest Worker receives events at the edge location closest to the visitor.
- Queues buffer spikes, and an aggregator Worker writes events in batches.
- Each website has its own SQLite database in a Durable Object, which holds events, sessions, people, logs and rollups.
- D1 keeps accounts, websites and settings. R2 stores replay recordings. KV holds realtime counters and caches.

On Flareboard Cloud all of this is run for you. If you self-host for noncommercial use, it lives in your own Cloudflare account.

## When to choose which

Stay on Umami if it covers your reports today and you want the smallest analytics footprint.

Choose Flareboard if you want:

- Feature flags and experiments that read the same events as your funnels
- Surveys, error tracking, logs and traces next to your product analytics
- Read-only SQL over your events, or an MCP server for AI tools
- Analytics that run on Cloudflare instead of a separate server

## Next steps

- [Compare all alternatives](https://flareboard.dev/compare)
- [Open the live demo](https://flareboard.dev/demo)
- [Create a free account](https://flareboard.dev/register)
