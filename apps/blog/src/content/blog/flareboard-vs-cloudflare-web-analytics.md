---
title: Flareboard vs Cloudflare Web Analytics
description: Cloudflare Web Analytics is a useful free overview — Flareboard is a dedicated analytics product with full counts, UTM, goals, and data you own in D1/R2.
pubDate: 2026-06-08
author: Flareboard
tags:
  - cloudflare
  - comparison
---

Cloudflare Web Analytics is privacy-friendly and free — a solid traffic overview if you're already on Cloudflare. But it's a **side feature**, not a full analytics product.

Flareboard runs on the same Cloudflare primitives (Workers, D1, KV, R2, Queues) while targeting teams that need **accurate, actionable** data.

## Sampling and retention

Per [Cloudflare's docs](https://developers.cloudflare.com/web-analytics/faq/), Web Analytics keeps unsampled beacons for about **7 days**, then aggregates long-term storage to roughly **10%** of volume. Dashboard queries may apply additional adaptive sampling.

Flareboard stores **every event** you send — no extrapolation — and when self-hosted, retention is whatever you configure in D1/R2.

## Feature depth

Cloudflare Web Analytics covers basics: page views, referrers, countries, devices. It does **not** yet support UTM parameters or custom events in the public docs.

Flareboard includes:

- **UTM and attribution** reports
- **Goals, funnels, retention, journeys, cohorts**
- **Realtime globe** with live visitor map
- **Session replay and heatmaps** (Cloud plan)

## When to use which

| Use case | Cloudflare Web Analytics | Flareboard |
| --- | --- | --- |
| Quick free overview | ✅ | ✅ (free tier) |
| Year-over-year trends on exact counts | ⚠️ sampled | ✅ |
| Campaign / UTM tracking | ❌ | ✅ |
| Product analytics (funnels, goals) | ❌ | ✅ |
| Own the data in your CF account | Partial | ✅ self-host |

## Try both

Many teams run Cloudflare Web Analytics alongside a dedicated tool during migration. [Compare all alternatives](https://flareboard.dev/compare) or [start with Flareboard Cloud](https://flareboard.dev/register).
