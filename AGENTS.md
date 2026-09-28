# Flareboard — agent guide

Monorepo: `apps/dashboard` (Vite/React), `apps/api`, `apps/ingest`, `apps/blog` (Astro), packages. Dashboard UI is **Flareboard** — analytics on Cloudflare. Deeper brand/audit notes: `apps/dashboard/DESIGN-NOTE.md`. Redesign playbook: `docs/geist-redesign-playbook.md`.

## Design system (dashboard)

Use **CSS variables** from `apps/dashboard/src/styles/geist-tokens.css` (imported by `global.css`) — never hardcode one-off colors. Themes: `[data-theme="light"]` / `[data-theme="dark"]` on `<html>` (see `src/lib/theme.ts`, inline script in `index.html`).

Interactive primitives live under `apps/dashboard/src/components/ui/*` as **shadcn/ui Base UI** (`components.json` style `base-nova`, `@base-ui/react`). Prefer those over hand-rolled controls. Button keeps legacy `primary` / `danger` / `asChild` aliases.

### Principles

- **Minimal:** flat solids only — no gradients, no colored glows, no heavy decoration.
- **Hierarchy:** typography scale, spacing, 1px borders, light shadows (`--shadow-sm` / `--shadow-md`), gray accent rails on panels where needed.
- **Icons:** thin stroke SVGs (2px), Lucide-style — match `ThemeToggle` / header controls.

### Border radius

| Use | Token / value |
|-----|----------------|
| Form fields, chips, panels, header controls, cards | `--radius-sm` (6px) |
| Larger shells / soft containers | `--radius-md` (12px) |
| Rare oversized surfaces | `--radius-lg` (16px) |
| Pills (theme track only) | `999px` |

### Color palette

| Role | Token | Notes |
|------|-------|-------|
| Page bg | `--bg` | Geist `background-100` |
| Surfaces | `--bg-elevated` | elevated panels |
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

- Page content: `.page` — `1.5rem` padding; max `--container-max` 1200px.
- Panels: `1.5rem` padding (`.panel`, `.panel-body`).
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

**Data UI:** `.panel`, `.stat-card`, `.data-table`, `.stat-value` (mono tabular).

**Charts:** series strokes/fills and legend swatches share `apps/dashboard/src/lib/chart-colors.ts` + `--chart-1`…`--chart-6` / `--chart-pageviews|visitors|visits` in `geist-tokens.css`. Never use `--accent`, `--text`, or gray-1000 for data series (chrome only). Re-run `node apps/dashboard/scripts/check-chart-colors.mjs`.

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
- **Visitor IDs:** a monthly-salted hash of IP + user agent (`getSalt`, default `'month'`). IPs are never stored. Keep landing copy and the Privacy Policy consistent with this.
- **Logs:** never log one-time links or email bodies in production (`logUndeliveredLink` in `lib/email.ts`).

## Blog

`apps/blog` shares Geist tokens (`apps/blog/src/styles/geist-tokens.css`). Stay CSS-first (Astro); do not pull dashboard React/shadcn into the blog.

## Commands

```bash
pnpm --filter @flareboard/dashboard dev # http://localhost:5173
pnpm typecheck # all packages
```
