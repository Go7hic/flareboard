---
title: Flareboard vs Umami
description: Umami is excellent lightweight web analytics. Flareboard adds product workflows — flags, experiments, replay, errors, logs, and warehouse — on Cloudflare.
pubDate: 2026-07-08
author: Flareboard
tags:
  - umami
  - product-analytics
  - cloudflare
  - comparison
---

[Umami](https://umami.is) is one of the best privacy-focused web analytics tools available. It is fast, simple, and easy to self-host. Flareboard starts from a similar place — cookieless pageview analytics on your own infrastructure — but targets teams that have **outgrown traffic dashboards** and need product analytics workflows in the same shell.

## Lightweight analytics vs product analytics

| Use case | Umami | Flareboard |
| --- | --- | --- |
| Pageviews, referrers, realtime | ✅ | ✅ |
| Funnels, retention, journeys, cohorts | Limited / basic | ✅ |
| Feature flags & experiments | ❌ | ✅ |
| Surveys | ❌ | ✅ |
| Session replay & heatmaps | ❌ | ✅ (Cloud plan) |
| Error tracking & logs | ❌ | ✅ |
| D1 warehouse SQL | ❌ | ✅ |
| Cloudflare-native stack | Via Docker/VPS | **Workers, D1, KV, R2, Queues** |

Umami optimizes for **clarity and minimalism**. Flareboard optimizes for **product teams** that want PostHog-style workflows without leaving Cloudflare.

## Migration-friendly details

Flareboard does not require you to throw away Umami habits:

- **Declarative click tracking** — `data-umami-event` attributes work alongside `data-flareboard-event`
- **Self-host on Cloudflare** — no separate VPS if you already run Workers
- **Same privacy posture** — cookieless defaults, first-party ingest, data in your account

If Umami covers everything you need today, keep using it. If you are adding replay, flags, or error tracking as bolt-on tools, Flareboard consolidates those paths.

## Infrastructure comparison

Umami typically runs as a Node app with PostgreSQL or MySQL on a VPS or container platform.

Flareboard runs entirely on Cloudflare:

- **Ingest Worker** at the edge, closest PoP to visitors
- **D1** for analytics storage and rollups
- **R2** for session replay chunks
- **Queues + aggregator** for spike buffering and batch writes
- **KV** for realtime counters and API cache

Teams already paying for Cloudflare can colocate analytics with the rest of their edge stack instead of operating a separate analytics server.

## When to choose which

**Stay on Umami** if you want the smallest possible analytics footprint and only need traffic reporting.

**Move to Flareboard** if you need:

- Product analytics reports beyond top pages and referrers
- Feature flags or experiments tied to the same event stream
- Session replay stored in your own R2 bucket
- Error and log views next to funnel and retention charts
- A path to Flareboard Cloud without maintaining a VPS

## Next steps

- [Compare all alternatives](https://flareboard.dev/compare)
- [See the full feature list](https://flareboard.dev/features)
- [Create a free account](https://flareboard.dev/register)

Start with one site, paste the snippet, and keep Umami running in parallel until your dashboards cover the workflows you need.
