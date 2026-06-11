# Flareboard Blog

Static blog for [flareboard.dev/blog](https://flareboard.dev/blog) — Astro + MDX (static output, no SSR adapter), deployed to Cloudflare Workers static assets.

## Develop

```bash
pnpm dev:blog
# http://localhost:4321/blog
```

## Add a post

Create `src/content/blog/your-slug.md` or `.mdx` with frontmatter:

```yaml
---
title: Post title
description: One-line summary for SEO and cards
pubDate: 2026-06-10
author: Flareboard
tags:
  - cloudflare
---
```

## Deploy

```bash
PUBLIC_SITE_URL=https://flareboard.dev \
PUBLIC_MARKETING_ORIGIN=https://flareboard.dev \
pnpm deploy:blog
```

Configure a Workers route `your-domain.com/blog*` → `flareboard-blog`. See [docs/deployment.md](../../docs/deployment.md).
