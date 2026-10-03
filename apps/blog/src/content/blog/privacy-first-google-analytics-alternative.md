---
title: Privacy-first product analytics on Cloudflare
description: Why teams pick cookieless product analytics that runs on Cloudflare Workers and Durable Objects instead of Google Analytics.
pubDate: 2026-06-01
updatedDate: 2026-10-03
author: Flareboard
tags:
  - product-analytics
  - posthog
  - privacy
  - cloudflare
---

Google Analytics 4 is powerful, but product teams need more than pageview reports. Feature flags, experiments, surveys, session replay, errors and logs work best when they share the same events, and most teams don't want to run a heavyweight analytics cluster to get that.

Flareboard is a privacy-first product analytics tool that runs on Cloudflare:

- **No cookies.** Visitors are counted with a hash of IP and user agent whose salt changes every month. IP addresses are never stored.
- **Opt-in memory.** If you want to recognize returning visitors across months, you turn that on per website, and you can wait for consent before the tracker stores anything.
- **Inputs stay private.** Autocapture never records what people type, and session replays mask form inputs by default.
- **Edge ingest.** Events reach the Cloudflare location closest to each visitor.

## Who this is for

Flareboard fits teams that want product analytics without operating it:

1. **Flareboard Cloud.** Hosted for you, with a free plan of 100,000 events a month.
2. **Self-hosting.** Deploy to your own Cloudflare account with Wrangler, for personal and other noncommercial use.

## How it differs from Google Analytics

| Topic | Google Analytics | Flareboard |
| --- | --- | --- |
| Cookies | Sets cookies by default | None by default |
| Raw events | Sampled and thresholded in some reports | Every event kept, with read-only SQL access |
| Product tools | Reports and ad audiences | Flags, experiments, surveys, replay, errors and logs |
| Where data lives | Google's cloud | One database per website on Cloudflare, or your own account when self-hosted |

## Next steps

- Open the [live demo](https://flareboard.dev/demo)
- Read [Flareboard vs PostHog](https://flareboard.dev/blog/flareboard-vs-posthog) or [Flareboard vs Umami](https://flareboard.dev/blog/flareboard-vs-umami)
- See [how we compare](https://flareboard.dev/compare) to GA, Umami, Plausible, Cloudflare Web Analytics and PostHog
- [Start free](https://flareboard.dev/register) on Flareboard Cloud
