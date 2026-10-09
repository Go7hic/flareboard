---
title: Flareboard documentation
sidebarTitle: Introduction
description: How to add Flareboard to a website or app, send events, and use analytics, replay, feature flags, errors and the API. Written for people and for the AI agents that help them.
---

Flareboard is product analytics that runs on Cloudflare. One script tag (or your existing PostHog SDKs) gives you web analytics, funnels, retention, session replay, heatmaps, feature flags, experiments, surveys, error tracking, logs and LLM cost tracking in one dashboard.

You can use it two ways:

- **Flareboard Cloud** at [flareboard.dev](https://flareboard.dev). We run it for you. The Free plan covers one website and 100K events a month.
- **Self-hosted** on your own Cloudflare account, with the same code. Free for non-commercial use. See [Self-host Flareboard](/docs/self-host/deploy).

## Start here

1. [Quickstart](/docs/quickstart): create an account, add a website, install the script and see your first visit. About five minutes.
2. [Concepts](/docs/concepts): websites, project keys, visitors, sessions and events, and how visitors are counted without cookies.
3. [Install the tracking script](/docs/install/script) or another way to send data: [npm package](/docs/install/npm), [frameworks](/docs/install/frameworks), [PostHog SDKs](/docs/install/posthog) or [server-side events](/docs/install/server).

## Common tasks

| I want to | Read |
| --- | --- |
| Count pageviews and visitors | [Web analytics](/docs/web-analytics) |
| Track sign-ups, purchases and other actions | [Track events](/docs/events) |
| See where people drop off | [Product analytics](/docs/product-analytics) |
| Watch what a visitor did | [Session replay](/docs/session-replay) |
| Release a feature to some users | [Feature flags](/docs/feature-flags) |
| Find and fix JavaScript errors | [Error tracking](/docs/error-tracking) |
| Query my data from Claude, Cursor or another AI tool | [MCP server](/docs/mcp) |
| Read or change data from my own code | [REST API](/docs/api) |

## Using an AI agent

These docs are written so an agent can follow them. Every page is also plain Markdown: add `.md` to the address (for example [/docs/quickstart.md](/docs/quickstart.md)). [/docs/llms.txt](/docs/llms.txt) lists every page, and [/docs/llms-full.txt](/docs/llms-full.txt) has all of them in one file.

To have an agent install Flareboard in your project, see [Set up Flareboard with an AI agent](/docs/ai-agents).

## Get help

- Email [support@flareboard.dev](mailto:support@flareboard.dev).
- Report bugs on [GitHub](https://github.com/Go7hic/flareboard/issues).
- Try the [live demo](https://flareboard.dev/demo) with sample data, no account needed.
