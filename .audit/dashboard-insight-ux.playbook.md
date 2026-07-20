# Dashboard insight UX — figure-it-out playbook

Source inventories: shared-display audit `e6377522`, route inventory `462a566e`.

## Predicate (Phase A)

Core analysis paths show locale-consistent numbers, durations, percents, and compare deltas; shared StatCard / chart / table / DataViewState levers land on ≥8 analytics pages; overview reads as hero metrics → chart → dimensions → drill; each unit has evidence in `.audit/dashboard-insight-ux.tsv`.

## Units (Phase B → C)

| Unit | Hypothesis | Verify |
|------|------------|--------|
| U0 format | One `lib/format.ts` via `getLocale()` ends ad-hoc `toLocaleString` / `%` / duration drift | typecheck; WebsiteStats + Compare + Replays use helpers |
| U0.5 overview | WebsiteStats hierarchy: hero KPIs → chart → ranked dimensions → explorer drill | light/dark smoke; fewer equal-weight panels |
| U0.6 report chrome | One website control bar pattern (range, segment, compare, export) | Stats + Funnel + Retention + UTM share one control component API |
| U1 StatCard | Promote `ui/StatCard` + `StatChangeDelta`; retire page-local KPI shells | ≥5 pages import shared StatCard |
| U2 AnalyticsChart | Recharts shell with colors, tooltip, tick formatters | Stats + Funnel + Reports use wrapper |
| U3 Sortable table | MetricsTable optional column sort + Sessions load-more | Breakdown + Errors + Sessions |
| U4 DataViewState | loading / error / empty / children | failed query shows retry on Stats + Sessions |
| U5 Core paths | Apply levers on realtime, sessions, funnel, retention, errors, insights, breakdown | TSV VERIFIED per page |
| U6 Reports IA | Resolve `/reports` vs dedicated website routes (link-out or thin hub) | no duplicate funnel/retention UX drift |
| U7 Event picker | Catalog autocomplete for funnel / stickiness / insights | bad free-text empty charts drop |

## Out of scope (for now)

Marketing landing polish, billing copy, accent-rail revival, new metrics backends, warehouse/admin power-user redesign (later phase G).
