# Panel nesting triage — lever + decisions

## Predicate

Decorative nesting (solid `.panel` around dashed `EmptyState`, or outer `.panel` around already-bordered MasterDetail list/pane) is gone from operator-facing empty-first and master-detail pages. Content chrome stays (KPI, chart, table, settings rails, intentional Errors/Logs **primary** heroes, card-grid empties).

**Binary rule:** when the only job of an outer `.panel` is to wrap EmptyState / DataViewState empty, or MasterDetail whose list/pane already border themselves → **drop the outer panel**. No `maybe` limbo.

## Lever

```bash
node .audit/scan-panel-nesting.mjs
node .audit/scan-panel-nesting.mjs --json
```

Heuristics flag candidates (exact `panel` class token + balanced tag body). **Verdicts live only in `panel-nesting-triage.tsv`** as `keep` | `fix`. Re-run after waves; remaining smells must be documented keep FPs (chart-in-panel, MD chrome, card grid, primary Errors/Logs).

## Criteria

**Fix** when any of:

1. Outer `.panel` wraps `MasterDetail*` whose list items + pane already have borders.
2. `EmptyState` (or `DataViewState` empty → dashed block) is the sole meaningful child of a bordered panel.
3. `.panel.empty-state-rich` wraps EmptyState (solid + dashed) on a page frame (not a card-grid slot).
4. Titled secondary section whose body is header + EmptyState / MD with no other content chrome.

**Keep** when:

- Overview KPI / dimension / map panels (`OverviewDimensionCard`, UTM dimension cards, breakdown).
- Primary chart-in-panel or table-in-panel (WebsiteStats chart, Sessions filters + table, Errors/Logs **primary** heroes).
- Settings / form accent sections and create-form panels with real fields.
- Marketing / auth / SharePublic frames.
- Card-grid empty placeholders (Websites, Boards, DashboardHome, Reports hub).
- Populated MD chrome when `wrapList={false}` (Teams sidebar, Replays list/player).
- Audit Log after `15a1f6d` (gold standard).

## Spot-check

| Sample | Scan | Verdict | Note |
|--------|------|---------|------|
| WebsiteAuditLog | clean | keep | Gold standard |
| Insights | clean | fix | Outer MD panel dropped |
| WebsiteErrors primary | MD wrap | keep | Table-in-panel hero |
| WebsiteLogs secondary | clean | fix | Traces/filters/alerts flattened |
| WebsiteStats chart | empty sole | keep | Chart body empty |
| Teams empty | clean | fix | Empty flattened; sidebar keep |
| Boards empty li | empty-rich | keep | Card-grid slot |
| OverviewDimensionCard | DVS wrap | keep | Dimension by design |

## Status

- Audit Log: `15a1f6d`
- MD + empty-first wave: `791b858`
- Empty/DVS + secondary More wave: `1c9aca9`
- Triage is binary (`keep` | `fix`); `maybe` retired.
