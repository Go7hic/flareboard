# Flareboard Dashboard Design

## Brand

| Element | Value |
|---------|--------|
| Name | **Flareboard** |
| Tagline | Product analytics on Cloudflare |
| Logo | `BrandLogo` — teal rounded dashboard tile (`#0d9488`), white chart line, orange peak dot + corner flare (`#f6821f`); flat solids only |
| Favicon | `public/logo.avif` (same mark) |
| OG image | `public/ogimg.webp` (1200×630) |
| Nav wordmark | Outfit, via `.brand-logo-wordmark` inside `.shell-brand` |

## Design read

**Reading this as:** B2B product analytics UI for technical operators, growth teams, and product owners who want a PostHog-like surface on Cloudflare infrastructure. The dashboard should keep Cloudflare-native devtool trust while making experimentation, feedback, quality, and warehouse workflows readable for non-infra users.

### taste-skill approach

| Surface | Skill path | Notes |
|---------|------------|-------|
| Landing (`/`) | taste-skill Section 0–10 | Full marketing treatment, CF pipeline hero |
| Authenticated dashboard | redesign-SKILL.md audit-first | Section 0 excludes dashboards from landing rules; dials tuned for density |

### Dashboard dials

| Dial | Value | Notes |
|------|-------|-------|
| DESIGN_VARIANCE | 4 | Stable grid, predictable nav — operator tool |
| MOTION_INTENSITY | 4 | Hover/press only; respects `prefers-reduced-motion` |
| VISUAL_DENSITY | 7 | Stat grids, tables, charts, mono numerics |

## Redesign audit (before → after)

| Pattern | Before | After |
|---------|--------|-------|
| Typography | Mixed inline styles | Outfit + JetBrains Mono via tokens; `.section-title` scale |
| Nav | Flat links | Sticky glass nav, active inset accent bar, Cloudflare tagline |
| Stat cards | Generic boxes | Primary highlight card, mono tabular values, hover elevation |
| Tables | Plain rows | `.data-table` + inline bar fill in `MetricsTable` |
| Snippet | Raw `<pre>` | `.snippet-panel` with live indicator + accent rail |
| Realtime | Inline heading styles | `.realtime-panel` accent rail + flat elevated bg, structured feed |
| Empty states | One-line text | `.empty-state-rich` with numbered steps (websites, teams, boards) |
| Login | Basic card | CF Workers badge, bridge copy to landing |
| Theme toggle | Hidden icons | Sun/moon inside track, `is-dark` on control |
| Share public | Minimal header | Brand row + read-only badge, chart panel parity |

## No gradients policy

Dashboard and landing surfaces use **flat, solid colors only** — no `linear-gradient`, `radial-gradient`, mesh/aurora backgrounds, gradient stat cards, gradient CTA bands, or SVG gradient strokes/fills.

**Hierarchy instead of gradients:**

- Typography scale (`.landing-headline`, `.page-title`, `.section-title`)
- Spacing and grid asymmetry (landing bento, stat grids)
- 1px borders (`--border`, `--border-strong`) and accent rails (3px left/top on panels and feature cards)
- Solid `color-mix` tints on `--bg-elevated` / `--bg-subtle` (accent-muted, cf-orange-muted)
- Neutral shadows (`--shadow-sm`, `--shadow-md`) — no colored glow washes

**Allowed motion:** skeleton opacity pulse, live-dot pulse, landing reveal — not gradient shimmer sweeps.

**Charts:** line strokes and bar fills use solid `--chart-line` / `--accent`; semi-transparent area fills are flat `color-mix`, not SVG `<linearGradient>`.

## Theme system

- **Tokens:** `src/styles/global.css` — `[data-theme="light"]` and `[data-theme="dark"]` on `<html>`
- **Default:** `prefers-color-scheme` when no `localStorage` override
- **Persistence:** `localStorage` key `flareboard-theme`
- **Flash prevention:** inline script in `index.html` before paint
- **Toggle:** `ThemeToggle` in AppShell, Login, and Landing nav

### Palette

| Token | Light | Dark |
|-------|-------|------|
| Background | `#f4f6fa` airy | `#0a0d12` blue-charcoal |
| Accent (Flareboard) | `#0d9488` teal | `#2dd4bf` mint-teal |
| Cloudflare callout | `#e85d04` orange | `#f6821f` orange |
| Typography | Outfit | Outfit |
| Data | JetBrains Mono | JetBrains Mono |

## Landing messaging (prominent)

1. **Hero** — Product analytics badge; headline leads with product analytics on Cloudflare; subhead names Workers, D1, R2, Queues; pipeline visual (Edge Ingest → Queue → D1 → Dashboard).
2. **Why not the old stack?** — Privacy, data ownership, edge speed, and lower ops burden than ClickHouse/Kubernetes products.
3. **Cloudflare stack** — Workers, D1, R2, KV, Queues with role copy for Flareboard.
4. **Features bento** — asymmetric cells for analytics, replay, flags, experiments, surveys, errors/logs, warehouse, and collaboration.
5. **Trust** — Runs on Cloudflare global network; decorative edge-node field (not a fake dashboard screenshot).
6. **CTA band** — Deploy on Cloudflare in minutes → `/login`.

Primary conversion CTA label: **Get started** (hero + footer). CTA band uses **Deploy on Cloudflare**.

## Authenticated routes

| URL | Purpose |
|-----|---------|
| `/login` | Sign in → `/websites` |
| `/websites` | Website list |
| `/websites/:id` | Website overview, traffic, events, sessions, realtime, performance |
| `/websites/:id/actions` | Action definitions |
| `/websites/:id/people` | People list and profile drilldown |
| `/websites/:id/groups` | Group analytics |
| `/websites/:id/feature-flags` | Feature flags and targeting |
| `/websites/:id/experiments` | Experiments and results |
| `/websites/:id/surveys` | Surveys, responses, and feedback inbox |
| `/websites/:id/errors` | Error tracking issues |
| `/websites/:id/logs` | Logs and traces |
| `/websites/:id/ai-observability` | AI observation events |
| `/websites/:id/workflows` | Event-triggered workflows |
| `/websites/:id/warehouse` | D1 warehouse query workbench |
| `/websites/:id/replays` | Session replay player |
| `/websites/:id/annotations` | Release, campaign, incident, and experiment annotations |
| `/websites/:id/audit` | Website audit log |
| `/teams` | Teams CRUD + join |
| `/links` | Short links & pixels |
| `/reports` | Funnels, vitals, UTM, revenue, retention, journeys |
| `/insights` | Saved trend, funnel, retention, path, stickiness, and table insights |
| `/boards` | Custom widget boards |
| `/admin` | Users, teams, websites (admin) |
| `/share/:slug` | Public read-only stats |

## API integration

All API calls, routes, mutations, and query keys are unchanged.

## Preview

```bash
cd <repo-root>
pnpm --filter @flareboard/dashboard dev
```

Open `http://localhost:5173/` for landing. Toggle theme in nav. Sign in at `/login` (admin / flareboard), then **`/websites`** for the redesigned dashboard.
