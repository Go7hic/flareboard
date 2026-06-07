# Flareboard — agent guide

Monorepo: `apps/dashboard` (Vite/React), `apps/api`, `apps/ingest`, packages. Dashboard UI is **Flareboard** — analytics on Cloudflare. Deeper brand/audit notes: `apps/dashboard/DESIGN-NOTE.md`.

## Design system (dashboard)

Use **CSS variables** in `apps/dashboard/src/styles/global.css` — never hardcode one-off colors. Themes: `[data-theme="light"]` / `[data-theme="dark"]` on `<html>` (see `src/lib/theme.ts`, inline script in `index.html`).

### Principles

- **Minimal:** flat solids only — no gradients, no colored glows, no heavy decoration.
- **Hierarchy:** typography scale, spacing, 1px borders, light shadows (`--shadow-sm` / `--shadow-md`), teal accent rails on panels where needed.
- **Icons:** thin stroke SVGs (2px), Lucide-style — match `ThemeToggle` / header controls.

### Border radius

| Use | Token / value |
|-----|----------------|
| Form fields, small chips | `--radius-sm` (6px) |
| Buttons, panels, header controls, dropdowns | `--radius-md` (10px) |
| Stat cards, larger panels | `--radius-lg` (14px) |
| Pills (theme track, badges) | `999px` |

Marketing/hero cards may use larger visual radius in comps; **authenticated shell** uses the tokens above consistently.

### Color palette

| Role | Light | Dark |
|------|-------|------|
| Page bg | `--bg` `#f4f6fa` | `#0a0d12` |
| Surfaces | `--bg-elevated` white | `#12161f` |
| Subtle fill | `--bg-subtle` | `#181d28` |
| Text | `--text` slate-900-ish | `--text` light |
| Muted text | `--text-muted` | same token |
| Borders | `--border`, `--border-strong` | same tokens |
| Accent (brand) | `--accent` `#0d9488` teal | `#2dd4bf` mint-teal |
| Accent tint | `--accent-muted` | same token |
| CF callout | `--cf-orange` | same token |

Header chrome: `--shell-bg` + `backdrop-filter` on `.shell-nav` (see `global.css`).

### Spacing

- Page content: `.page` — `1.75rem` vertical, `1.5rem` horizontal; max `--container-max` 1240px.
- Panels: `1.35rem` padding (`.panel`, `.panel-body`).
- Header control row: `.shell-nav-end` — `gap: 0.5rem`, align center with nav height `--nav-height` 60px.

### Component patterns

**Header controls row** (`.shell-nav-end`): locale → theme → logout. All controls share elevated surface + thin border + `--radius-md`.

| Control | File | Classes / notes |
|---------|------|-----------------|
| Locale | `src/components/LanguageSelector.tsx` | `.locale-selector-*`; menu uses `--bg-elevated`, active option `--accent-muted` + `--accent` |
| Theme | `src/components/ThemeToggle.tsx` | `.theme-toggle`; pill track, teal `.theme-toggle-thumb` |
| Logout | `AppShell.tsx` | `.btn.btn-ghost.btn-sm.shell-logout` |

**Buttons:** `.btn-primary` (teal fill), `.btn-secondary`, `.btn-ghost`, `.btn-danger`; sizes `.btn-sm`, `.btn-lg`.

**Forms:** `.field` + `.field-label` + `.input` / `.select` / `.textarea` (full-width in forms; **do not** use raw `.select` in the shell header — use `LanguageSelector`).

**Nav links:** `.shell-link` / `.shell-link.active` (inset accent bar).

**Data UI:** `.panel`, `.stat-card`, `.data-table`, `.stat-value` (mono tabular).

### i18n

- Locales: `LOCALES` in `src/lib/i18n.ts` (`en-US`, `zh-CN`, `ja-JP`, `de-DE`, `fr-FR`).
- Short labels: `LOCALE_LABELS`; strings via `t(key)`.
- Changing locale persists `flareboard_locale` and reloads the app.

### When editing UI

1. Read `ThemeToggle.tsx`, `LanguageSelector.tsx`, and `AppShell.tsx` for header parity.
2. Prefer existing tokens/classes over new one-offs.
3. Verify **light and dark** (`data-theme` toggle).
4. Run `pnpm typecheck` (root or `apps/dashboard`).
5. Do not add gradients or heavy box-shadows.

## Commands

```bash
pnpm --filter @flareboard/dashboard dev   # http://localhost:5173
pnpm typecheck                            # all packages
```
