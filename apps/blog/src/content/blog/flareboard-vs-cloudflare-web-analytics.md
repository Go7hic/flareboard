---
title: Flareboard vs Cloudflare Web Analytics
description: Cloudflare Web Analytics is a useful free traffic overview. Flareboard is a full analytics product on the same platform, with exact counts, UTM, custom events, funnels and more.
pubDate: 2026-06-08
updatedDate: 2026-10-03
author: Flareboard
tags:
  - cloudflare
  - comparison
---

Cloudflare Web Analytics is privacy-friendly and free, and it is a solid traffic overview if your site is already on Cloudflare. It is a side feature of Cloudflare, though, not a full analytics product.

Flareboard runs on the same platform, on Workers, Durable Objects, D1, R2, KV and Queues, and is built for teams that need exact numbers and product analytics.

## Sampling and retention

Cloudflare's [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/) says it keeps unsampled data for the past 7 days, and after that aggregates it down to around 10%.

Flareboard keeps every event you send, with no sampling or extrapolation. On Flareboard Cloud, data is kept for 1 year on the free plan, 2 years on Cloud and 3 years on Business. When you self-host, you decide.

## Feature depth

Cloudflare Web Analytics covers the basics: pageviews, referrers, countries, devices and Web Vitals. Its FAQ says custom events and UTM parameters are not supported yet.

Flareboard adds:

- Custom events, UTM and attribution reports
- Goals, funnels, journeys, retention, stickiness and cohorts
- A realtime globe with the visitors on your site right now
- Session replay and heatmaps on paid plans
- Feature flags, experiments, surveys, error tracking and logs

## When to use which

| Use case | Cloudflare Web Analytics | Flareboard |
| --- | --- | --- |
| A quick, free traffic overview | Yes | Yes, on the free plan |
| Exact counts over months and years | Sampled after 7 days | Yes |
| Campaign and UTM tracking | Not yet | Yes |
| Custom events, funnels and goals | Not yet | Yes |
| Data in your own Cloudflare account | Cloudflare's own service | When you self-host |

## Try both

Many teams keep Cloudflare Web Analytics on while they evaluate a dedicated tool. [Open the live demo](https://flareboard.dev/demo), [compare all alternatives](https://flareboard.dev/compare) or [start free on Flareboard Cloud](https://flareboard.dev/register).
