# Flareboard — agent guide

Monorepo: `apps/dashboard` (Vite/React), `apps/api`, `apps/ingest`, `apps/blog` (Astro), packages. Dashboard UI is **Flareboard** — analytics on Cloudflare. **Console design spec (v2): `docs/dashboard-design-system.md`** — page anatomy, building blocks, chart rules; follow it for every dashboard page. Brand notes: `apps/dashboard/DESIGN-NOTE.md`.

## Design system (dashboard)

Use **CSS variables** from `apps/dashboard/src/styles/geist-tokens.css` (imported by `global.css`) — never hardcode one-off colors. Themes: `[data-theme="light"]` / `[data-theme="dark"]` on `<html>` (see `src/lib/theme.ts`, inline script in `index.html`).

Interactive primitives live under `apps/dashboard/src/components/ui/*` as **shadcn/ui Base UI** (`components.json` style `base-nova`, `@base-ui/react`). Prefer those over hand-rolled controls. Button keeps legacy `primary` / `danger` / `asChild` aliases.

### Principles

- **Minimal:** flat solids only — no gradients, no colored glows, no heavy decoration.
- **Hierarchy:** typography scale, spacing, 1px borders. Cards are flat (no shadow) on the off-white page (`--bg` #fafafa / dark #000, cards `--bg-elevated`); shadows only for popovers and dialogs. One container level: no bordered boxes inside cards.
- **Answer first:** pages lead with a KPI strip / primary chart / list; create and configure live in dialogs opened from header buttons.
- **Fonts:** Geist is self-hosted (`src/assets/fonts`, `@font-face` in `global.css`); never load fonts from a CDN.
- **Icons:** thin stroke SVGs (2px), Lucide-style — match `ThemeToggle` / header controls.

### Border radius

| Use | Token / value |
|-----|----------------|
| Form fields, chips, badges, header controls, inner tiles | `--radius-sm` (6px) |
| Cards (`.panel`, `SectionCard`, KPI strip), dialogs, popovers | `--radius-md` (12px) |
| Rare oversized surfaces | `--radius-lg` (16px) |
| Pills (theme track only) | `999px` |

### Color palette

| Role | Token | Notes |
|------|-------|-------|
| Page bg | `--bg` | Geist `background-200` (#fafafa) / dark #000 |
| Cards | `--bg-elevated` | #fff / dark #0a0a0a |
| Subtle fill | `--bg-subtle` | gray-100 |
| Text | `--text` | Geist `gray-1000` |
| Muted text | `--text-muted` | Geist `gray-900` |
| Borders | `--border`, `--border-strong` | gray-alpha |
| Primary CTA / accent | `--accent` / `--primary` | Geist `gray-1000` (near-black / near-white) |
| Accent tint | `--accent-muted` | gray-alpha wash |
| Links / focus | `--link`, `--focus-ring` | Geist blue |
| CF callout | `--cf-orange` | Cloudflare brand only, not chrome |

Header chrome: `--shell-bg` + `backdrop-filter` on `.shell-nav` / `.landing-nav`.

### Spacing

- Page content: `.page` — `1.5rem` padding (2rem ≥ 1280px); max `--container-max` 1320px.
- Cards: `1.25rem` padding (`--card-pad-x/y`); gap between cards `--section-gap` (1rem); `.stack` / `.layout-grid` (12 columns, `.span-N`).
- Header control row: `.shell-nav-end` — `gap: 0.5rem`, align center with nav height `--nav-height` 64px.

### Component patterns

**Header controls row** (`.shell-nav-end`): locale → theme → logout. Elevated surface + thin border + `--radius-sm`.

| Control | File | Classes / notes |
|---------|------|-----------------|
| Locale | `src/components/LanguageSelector.tsx` | `.locale-selector-*` |
| Theme | `src/components/ThemeToggle.tsx` | `.theme-toggle`; pill track, gray `.theme-toggle-thumb` |
| Logout | `SidebarShell` / user menu | ghost button or sidebar footer |

**Buttons:** always `src/components/ui/button` (`default`/`primary` = gray-1000); the legacy `.btn*` classes are gone. Row-level deletes in lists/tables use `variant="destructive-ghost" size="sm"`; the tinted `danger` variant is for the confirm button and panel-level destructive actions.

**Dialogs & confirmation:** form dialogs use `ModalDialog` (Base UI, legacy `.dialog-header/-body/-footer` layout) or `ui/dialog`. Never delete on a single click and never use `window.confirm`: call `useConfirm()` from `src/components/ConfirmDialog.tsx` (`confirm({ title: deleteTitle(name), onConfirm })`). Portaled layers sit above the sticky topbar (z 100): dialogs `z-[300]`, popovers/selects/menus/tooltips `z-[310]`.

**Forms:** prefer shadcn `Input` / `Label` / `Select` / `Textarea`. Legacy `.field` + `.input` still work via tokens.

**Nav links:** `.shell-link` / `.sidebar-link.active` (inset gray bar).

**Data UI (console v2):** `SectionCard` (title, description, actions, `flush` for tables), `KpiStrip` + `KpiCell` (headline numbers, `StatChangeDelta` chips), `BreakdownList` (ranked rows with share bars), `.data-table` (sentence-case headers), `KvList`, `StatusBadge`, `EmptyState` (icon + next step), master–detail (`MasterDetailLayout listHeader`, `MasterDetailPane meta`). Big numbers use proportional Geist Sans; `tabular-nums` only in columns. Dates: `formatShortDateTime` / `formatRelativeTime`, never a full date as a big value.

**Charts:** `AnalyticsChart` (solid hairline grid, no axis lines, clean ticks, shared tooltip) with mark presets from `src/lib/chartMarks.ts` (`BAR_MARK` ≤ 24px with a 4px data end, `lineMark`), `ChartLegend` in the card header for ≥ 2 series. Series colors come from `useChartColors()` (resolved values; SVG attributes cannot read CSS variables) in the fixed slot order blue, orange, teal, purple, green, pink (`--chart-1…6`, validated for color-vision deficiency in both themes — re-validate with the dataviz checks before changing). Never `--accent`, `--text` or gray-1000 for series; status colors only for status. Re-run `node apps/dashboard/scripts/check-chart-colors.mjs`.

### i18n

- Locales: `LOCALES` in `src/lib/i18n.ts` (`en-US`, `zh-CN`, `ja-JP`, `de-DE`, `fr-FR`).
- Short labels: `LOCALE_LABELS`; strings via `t(key)`.
- Changing locale persists `flareboard_locale` and reloads the app.

### When editing UI

1. Read `ThemeToggle.tsx`, `LanguageSelector.tsx`, and `SidebarShell.tsx` / `AppSidebar.tsx` for shell parity.
2. Prefer Geist tokens + shadcn Base UI over new one-offs.
3. Verify **light and dark** (`data-theme` toggle).
4. Run `pnpm typecheck` (root or `apps/dashboard`).
5. Do not add gradients or heavy box-shadows.
6. Do not reintroduce teal as the primary brand accent.

## Data handling and the legal pages

`apps/dashboard/src/pages/Privacy.tsx` and `Terms.tsx` describe what the code actually does. When you change data collection, storage, cookies, subprocessors or retention, update the matching section and its `UPDATED` date in the same change.

- **Deletion:** deleting a website or account only sets `deleted_at`. `apps/api/src/lib/data-deletion.ts` (hourly cron) erases everything after `DELETION_GRACE_DAYS` (30, promised in both policies). It discovers website-scoped tables from the schema, so new tables with a `website_id` column are covered automatically; user references need a line in `USER_OWNED_TABLES` / `USER_REFERENCES`.
- **Replay:** R2 objects (`<websiteId>/<visitId>/<chunk>`) must be deleted before their `session_replay` rows (see `lib/retention.ts`). Privacy settings reach `recorder.js` through `/api/tracker-config` → `replay`; inputs are masked unless a site opts out.
- **Visitor IDs:** a monthly-salted hash of IP + user agent (`getSalt`, default `'month'`). IPs are never stored. Opt-in exception: a website with "Remember visitors across sessions" (`website.persist_visitors`) gets a random `localStorage` id from `script.js`, which ingest uses instead (`resolveDistinctId` in `apps/ingest/src/lib/tracker-settings.ts`; anonymous ids are dropped on other websites). Keep landing copy and the Privacy Policy consistent with this.
- **Tracker:** the source is `apps/ingest/src/tracker/script.ts` (tests in `apps/ingest/test-node`, run in a fake browser). Autocapture must never send field values; update the Privacy Policy when it collects anything new.
- **Logs:** never log one-time links or email bodies in production (`logUndeliveredLink` in `lib/email.ts`).
- **Security records:** sign-in audit records are pruned after 180 days (`SIGN_IN_RECORD_DAYS` in `data-deletion.ts`) and 2FA secrets, recovery codes and sessions are user-owned tables erased with the account. Both policies promise this.
- **AI assistant:** "Ask Flareboard" calls DeepSeek (`DEEPSEEK_API_KEY`, `apps/api/src/lib/assistant.ts`, Anthropic-format endpoint). Data sent to it is stored in China and may be used by DeepSeek to improve its models; the Privacy Policy (`#assistant`, subprocessors, transfers) says so. Changing the provider or what is sent means updating those sections.
- **Plan allowances:** `packages/shared/src/billing.ts` (events, replays, log/span rows, retention, grace). Usage lives in D1 `usage_monthly`: the aggregator counts events, ingest counts replays (first chunk) and OTLP rows; ingest only reads it through a 60 s KV cache (`assertEventAllowed`). Never count per event in KV (one write per second per key). Emails at 80 % / 100 % / stop come from `lib/usage-notices.ts`; hosted retention is capped by the owner's plan in `lib/retention.ts`. Changing allowances means updating pricing copy and both policies.
- **Warehouse credentials:** Stripe keys are restricted keys only, stored encrypted (`warehouse_credential`) and removed with the data source; never return or log them.

## Blog

`apps/blog` shares Geist tokens (`apps/blog/src/styles/geist-tokens.css`). Stay CSS-first (Astro); do not pull dashboard React/shadcn into the blog.

## Commands

```bash
pnpm --filter @flareboard/dashboard dev # http://localhost:5173
pnpm typecheck # all packages
```
