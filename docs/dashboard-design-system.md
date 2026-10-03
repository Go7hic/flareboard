# Flareboard console design system (v2)

The rules every dashboard page follows. `AGENTS.md` has the short version; this is the full spec.
The visual language stays Geist (flat, neutral, one accent per role, no gradients). What changes
in v2 is hierarchy and information display: each page leads with its answer, chrome gets quieter,
and the same few building blocks appear everywhere.

## 1. Principles

1. **Answer first.** A page opens with what the reader came for: the numbers, the chart, the list.
   Creating, configuring and testing are secondary: a button in the page header that opens a dialog
   or side sheet, never a form that pushes the data below the fold.
2. **One level of containers.** Page → cards. Never a bordered box inside a card; inside a card,
   separate with spacing and hairline dividers (`.card-divider`, `.kv-list`, table rows).
3. **Quiet chrome, loud data.** Hairline borders, no card shadows, muted labels, sentence case.
   Color is for data marks and status, not decoration.
4. **Numbers read cleanly.** Geist Sans everywhere for numbers. Big standalone values use
   proportional figures; columns of numbers (tables, axes, list values) use `tabular-nums`.
   Mono is only for code-like strings: event names, paths, keys, IDs, SQL, JSON.
5. **Dates are short.** Never a full date-time as a big value. Use `formatRelativeTime`
   ("3 min ago", "2 天前") in lists and `formatShortDateTime` ("Oct 2, 23:32" / "10月2日 23:32",
   year only when not the current year) elsewhere; the full timestamp goes in a `title`.
6. **Every state is designed.** Loading = skeleton in the final shape; refetch keeps the old render
   (TanStack `placeholderData: keepPreviousData`); empty = icon + one-line title + what to do;
   error = message + retry.

## 2. Surfaces and tokens

| Role | Light | Dark |
|------|-------|------|
| Page background `--bg` | `#fafafa` (Geist background-200) | `#000` |
| Cards `--bg-elevated` | `#fff` | `#0a0a0a` |
| Subtle fill `--bg-subtle` | gray-100 | gray-100 |
| Hairlines `--border` / `--border-subtle` | gray-alpha | gray-alpha |

- Cards: `--radius-md` (12px), 1px `--border`, no shadow. Controls, chips, inputs, badges, inner
  tiles: `--radius-sm` (6px).
- Status colors (`--success`, `--warning`, `--danger`) only mean state, always with a label or icon.

## 3. Typography

| Element | Spec |
|---------|------|
| Page title `.page-title` | 24px / 600 / -0.02em |
| Page lead `.page-subtitle` | 14px muted, max 72ch, wraps |
| Card title `.card-title` | 14px / 600 |
| Card description | 13px muted |
| Labels, table headers | 12–13px / 500 muted, sentence case (no uppercase tracking) |
| Body, table cells | 13.5–14px |
| KPI value | 28px / 600, proportional figures |
| Hero value (one per page at most) | 40px / 600 |

## 4. Page anatomy

```
PageHeader   title · lead                     [live] [segment] [date range] [export] | [primary action]
Toolbar      [search] [filter…] [filter…]                   (only when a page has many filters; one row, no box)
KpiStrip     one card, N cells split by hairlines (cells may be selectable → drive the chart)
Content      cards on a 12-column grid (.layout-grid, .span-4/.span-6/.span-8/.span-12)
```

- Report pages put their scope controls (segment, date range, export) in the header actions, right of
  the title; they wrap under it on narrow screens. Every chart and number on the page follows them.
- Streams and catalogs with several filters (logs, sessions, errors, people) use a toolbar row under
  the header (or the list card header in master–detail).

- Controls in the header and toolbar rows (date range, selects, search, buttons) are 32px tall
  (`--shell-control-height`, the Button / Select default). Under 900px the header actions move
  under the title, left-aligned, and wrap.
- Page width: `--container-max` (1320px), 24px gutters (16px under 640px).
- Rhythm: header → toolbar 16px; toolbar → content 20px; between cards 16px (`--section-gap`).
- Website pages: the top bar shows a breadcrumb (`All websites / Demo Store ▾`) instead of
  home + back buttons.

## 5. Building blocks

| Block | Component / class | Notes |
|-------|-------------------|-------|
| Page frame | `Page`, `PageBody`, `PageHeader` | `PageHeader actions` for create buttons; `toolbar` for filters |
| Card | `Panel` / `.panel`, `PanelHeader title description actions` | header 16px 20px, body 20px, `variant="flush"` for tables/lists |
| KPI strip | `KpiStrip` + `KpiCell` | label, value, delta, optional sparkline; `selected` + `onSelect` to switch a chart |
| Single stat | `StatCard` | only when a strip is wrong (e.g. one figure in a side column) |
| Chart | `AnalyticsChart` + `ChartLegend` | rules in §6 |
| Ranked list | `BreakdownList` (`.breakdown-*`) | label + share bar behind + right-aligned values; "View all" opens a sheet |
| Table | `.data-table` | 36px header (sentence case, muted, subtle fill), 44px rows, hover fill, numbers right + tabular |
| Master–detail | `MasterDetailLayout`, `MasterDetailListItem`, `MasterDetailPane` | list 320px card with search on top; selected row = sidebar active style; detail card with header, tabs, sections |
| Key–value | `.kv-list` (`<dl>`) | label column muted 13px, value 14px, hairline rows |
| Badge | `Badge` / `.status-badge` | tinted fill, 12px/500, 6px radius; neutral, success, warning, danger, info |
| Empty | `EmptyState` | icon tile + title + description + optional action; `variant="rich"` for page-level |
| Dialog / sheet | `ModalDialog`, `ui/dialog` | create/edit forms; labels above fields, actions bottom-right |
| Tabs | `ui/tabs` (underline) for sections of a detail; `.segmented` for 2–4 view toggles inside a card header |

## 6. Charts (from the dataviz method)

- Form first: one number → KPI cell, never a one-bar chart; trend → line (area wash at 10% for a
  single series); magnitude by category → horizontal bars; ordered stages (funnel) → bars with
  conversion labels; grid → heatmap.
- Categorical slots in fixed order: `--chart-1` blue, `--chart-2` orange, `--chart-3` teal,
  `--chart-4` purple, `--chart-5` green, `--chart-6` pink (validated light + dark, CVD ΔE ≥ 9.7).
  Color follows the entity (pageviews always slot 1, visitors slot 2, visits slot 3).
  Never more than 6 series: fold the tail into "Other".
- Lines 2px; bars ≤ 24px thick with a 4px rounded data-end and a 2px gap; markers ≥ 8px with a
  2px surface ring.
- Gridlines: solid 1px `--chart-grid`, horizontal only; no axis lines; ticks 11–12px muted with
  clean values (`niceTicks`).
- Legend for ≥ 2 series (line keys for lines, squares for bars), top-right of the card header;
  none for a single series (the card title names it).
- Hover: crosshair + one tooltip listing every series, value first; bars highlight on hover.
  Stacked bars with many series pass `ChartTooltipContent hideZero` so empty series drop out.
- Stacks with negative parts (lifecycle dormant, MRR churn) use `AnalyticsChart stackOffset="sign"`;
  automatic ticks cover negatives and bars inside `<BarStack>`. KPI cells that key a bar series
  use `keyShape="box"` to match the legend.
- Text never wears the series color; values and labels stay in text tokens.
- Chart height includes the axis band; no nested scroll.

## 7. Patterns by page type

- **Report pages** (overview, performance, retention, revenue…): header → toolbar → KPI strip →
  primary chart card → breakdown grid. The homepage hero (`landing/LandingProductPreview.tsx`) is
  a still of the website overview built from the same components and sidebar groups; check it
  after changing the overview.
- **Query pages** (funnel, journeys, stickiness, attribution, insights): a query card at the top
  (steps/filters in one compact block), the result card below with its own KPI line.
- **Catalogs and configs** (events, actions, flags, experiments, surveys, workflows, cohorts,
  segments, annotations): master–detail; create opens a dialog; the list shows status and one key
  metric per row; the detail leads with its numbers, then definition, then history.
- **Streams** (sessions, replays, logs, errors, audit): full-width filter row + table/list,
  detail on its own page or a side pane.
- **Settings** (website settings, billing, security, API keys, teams): left-aligned 720px column
  of cards, each card = one topic with its own save; danger zone last.

## 8. Responsive

- ≥ 1280px: full layout. 1024–1279: KPI strip wraps to 3 per row; master–detail list 280px.
- 768–1023: master–detail stacks (list above, detail below); grids become 2 columns.
- < 768: one column; header actions wrap under the title; tables scroll inside their card.
