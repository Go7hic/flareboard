# Flareboard Dashboard Design

## Brand

| Element | Value |
|---------|--------|
| Name | **Flareboard** |
| Tagline | Product analytics on Cloudflare |
| Logo | `BrandLogo` — mark in `public/logo.avif`; wordmark Geist Sans via `.brand-logo-wordmark` |
| Favicon | `public/logo.avif` |
| OG image | `public/og-image.jpg` (1200×630 JPEG, under 300 KB for chat apps): the homepage preview in light theme and en-US beside the tagline; regenerate it when the console look changes |
| Design language | **Vercel Geist** tokens + shadcn Base UI primitives |

## Design read

**Reading this as:** B2B product analytics UI for technical operators, growth teams, and product owners who want a PostHog-like surface on Cloudflare infrastructure. Visual system follows Geist (near-black primary CTAs, blue links/focus), not the former teal accent system.

Every console page follows the **console v2 spec** in `docs/dashboard-design-system.md`: answer first (KPI strip → primary chart or list), one container level (flat cards on an off-white page), create/edit in dialogs, master–detail for catalogs.

### Dashboard dials

| Dial | Value | Notes |
|------|-------|-------|
| DESIGN_VARIANCE | 4 | Stable 12-column grid, predictable nav — operator tool |
| MOTION_INTENSITY | 4 | Hover/press only; respects `prefers-reduced-motion` |
| VISUAL_DENSITY | 7 | KPI strips, tables, charts; Geist Sans numbers (proportional when big, `tabular-nums` in columns), mono only for code-like strings |

## Token source

- Generated / synced Geist palette: `src/styles/geist-tokens.css`
- App aliases and layout: `src/styles/global.css`
- Primitives: `src/components/ui/*` (shadcn `base-nova` / `@base-ui/react`)
- Playbook: `docs/geist-redesign-playbook.md`
- Decision trail: `.audit/geist-redesign.tsv`

## No gradients policy

Dashboard and landing surfaces use **flat, solid colors only** — no `linear-gradient`, `radial-gradient`, mesh/aurora backgrounds, gradient stat cards, gradient CTA bands, or SVG gradient strokes/fills.

**Hierarchy instead of gradients:**

- Typography scale (`.landing-hero-brand`, `.landing-headline`, `.page-title`, `.section-title`)
- Spacing and grid asymmetry
- 1px borders (`--border`, `--border-strong`); flat cards (`--bg-elevated`, 12px radius, no shadow) on the off-white page
- Solid `color-mix` tints on `--bg-elevated` / `--bg-subtle`
- Neutral shadows (`--shadow-sm`, `--shadow-md`) only for popovers and dialogs — no colored glow washes

**Allowed motion:** skeleton opacity pulse, live-dot pulse, landing reveal — not gradient shimmer sweeps.

**Charts:** line strokes and bar fills use solid series colors in a fixed slot order — `--chart-1` blue, `--chart-2` orange, `--chart-3` teal, `--chart-4` purple, `--chart-5` green, `--chart-6` pink (validated for color-vision deficiency in both themes); semi-transparent area fills are flat opacity, not SVG `<linearGradient>`. Status colors only for status.

## Theme system

- **Tokens:** `geist-tokens.css` under `[data-theme="light"]` / `[data-theme="dark"]` (and `:root` defaults)
- **Default:** `prefers-color-scheme` when no `localStorage` override
- **Persistence:** `localStorage` key `flareboard-theme`
- **Flash prevention:** inline script in `index.html` before paint
- **Toggle:** `ThemeToggle` in shell, Login, and Landing nav

### Palette (role → token)

| Role | Token |
|------|-------|
| Page background | `--bg` → Geist background-200 (#fafafa) / dark #000 |
| Cards | `--bg-elevated` → #fff / dark #0a0a0a |
| Text | `--text` → Geist gray-1000 |
| Primary CTA | `--primary` / `--accent` → Geist gray-1000 |
| Links / focus | `--link` / `--focus-ring` → Geist blue |
| Cloudflare callout | `--cf-orange` (brand only) |
| Typography | Geist Sans / Geist Mono, self-hosted (`src/assets/fonts`) |

## Shell

Authenticated chrome is `SidebarShell` + `AppSidebar` + `AppTopBar` (mobile). Active nav uses a 2px gray inset bar and muted fill, not teal.

## Marketing

Landing hero is brand-first (`Flareboard` as the hero-level name). Primary CTAs use shadcn `Button` default/primary (gray-1000). Avoid orange pill badges in the first viewport.
