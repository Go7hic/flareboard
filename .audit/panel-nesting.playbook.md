# Panel nesting triage — lever + decisions

## Predicate

Decorative nesting (solid `.panel` around dashed `EmptyState`, or outer `.panel` around already-bordered MasterDetail list/pane) is gone from operator-facing empty-first and master-detail pages. Content chrome stays (KPI, chart, table, settings rails, intentional Errors/Logs secondary “More” panels).

## Lever

```bash
node .audit/scan-panel-nesting.mjs
node .audit/scan-panel-nesting.mjs --json
```

Heuristics flag candidates. **Verdicts live only in `panel-nesting-triage.tsv`.** Re-run the lever after subtract waves to confirm smell rows drop.

## Criteria (decision rules)

**Subtract** when any of:

1. Outer `.panel` / `section.panel` wraps `MasterDetailLayout` / table-layout whose list items + pane already have borders.
2. `EmptyState` (or `DataViewState` empty → dashed block) is the sole meaningful child of a bordered panel.
3. `.panel.empty-state-rich` wraps `EmptyState` (solid + dashed / double empty chrome).

**Keep** when:

- Overview KPI / dimension / map panels.
- Primary chart-in-panel or table-in-panel with real toolbar/header chrome (incl. Sessions filters + table).
- Settings / form accent sections.
- Marketing / auth frames with no panel soup.
- Audit Log after `15a1f6d` (already flattened).

**Maybe** when:

- Errors/Logs secondary “More” panels with empties (intentional demotion).
- Warehouse / AI observability section empties inside titled panels.
- Funnel/Retention/UTM/Stickiness result panel wrapping `DataViewState` (empty path only).
- Board/site empty cards that occupy a card grid slot.

## Spot-check (trust calibration)

| Sample | Scan said | Verdict | Note |
|--------|-----------|---------|------|
| WebsiteAuditLog | clean | keep | Gold standard after outer-panel drop |
| Insights | MD wrap | subtract | Same pattern as pre-fix Audit Log |
| Annotations | MD wrap | subtract | Outer panel around MD + empty |
| WebsiteErrors primary | MD wrap | keep | Table-in-panel with issue header = content chrome |
| WebsiteLogs traces | MD wrap | maybe | Secondary “More” panel |
| WebsiteStats chart empty | empty sole | keep | Primary chart panel; empty is the chart body |
| Sessions | clean | keep | Empty sits under required filter row (U17.1) |
| Teams empty | empty+rich | subtract | `panel` + `EmptyState` only |
| Replays disabled | empty+rich | subtract | Double empty chrome |
| Replays populated | MD+panel list | keep | List/detail panels are the MD chrome |
| OverviewDimensionCard | DVS wrap | keep | Dimension panel by design |
| Boards empty li | empty-rich | maybe | Card-grid placeholder, not page frame |
| Admin forbidden | empty-rich | maybe | Rare path; single message panel OK |
| WebsiteCompare | missed empty-in-panel | maybe | FN: EmptyState inside compare panel when no data |

## Subtract wave (do not implement in this commit)

Ordered by operator empty-first impact:

1. Insights
2. Segments + Cohorts (shared panel wrappers)
3. People, Groups
4. Annotations, Workflows, Surveys, Experiments, Feature Flags, Actions, Events
5. Teams (empty only), Replays (disabled empty), LinkAnalytics, Journeys (empty sole)

Errors/Logs secondary and warehouse/AI stay **maybe**.

## Status

- Audit Log subtract: done (`15a1f6d`).
- This unit: lever + full triage only. No mass page edits.
