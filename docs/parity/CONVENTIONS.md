# PostHog-parity work: shared conventions

Several work streams run in parallel on separate branches cut from `feat/posthog-parity` and are
merged back by the coordinator. These rules keep them mergeable. Read `AGENTS.md` first; it still
applies (Geist tokens, shadcn Base UI, `useConfirm()`, legal pages kept true, etc.).

## Storage: always use `siteDb`

A website's analytics tables are moving from the shared D1 database into one SQLite Durable
Object per website. The table list is `SITE_TABLES` in `apps/api/src/lib/site-db.ts`
(website_event, event_data, session, session_data, revenue, session_replay*, heatmap_*,
rollup_*, person, person_group_membership).

- Read and write those tables only through `siteDb(env, websiteId)` (a D1-compatible handle).
  Everything else keeps using `env.DB`.
- Never join a SITE_TABLES table with a D1-only table (website, cohort, action_definition,
  feature_flag, experiment, survey, workflow, …) in one SQL statement. Load the D1 rows first,
  then pass values as parameters.
- Multi-website queries: call `siteDb` per website and merge in code.
- New event attributes go in event properties (`event_data` rows today, a JSON column later),
  not new columns on `website_event`. Filtering on a property:
  `EXISTS (SELECT 1 FROM event_data d WHERE d.website_event_id = e.event_id AND d.data_key = ?
  AND d.string_value = ?)` works in both storage backends.
- Tests: seed and assert SITE_TABLES with `testSiteDb(websiteId)` from
  `apps/api/test/helpers/site-db.ts`, never `env.DB`.

## Migrations (D1)

Each stream owns one migration number. Use only yours; skip it if you need none.

| # | Stream |
|---|--------|
| 0042 | storage (coordinator) |
| 0043 | api-keys-ingest |
| 0044 | experiments |
| 0045 | feature-flags |
| 0046 | insights-dashboards |
| 0047 | tracker-sdk |
| 0048 | error-tracking |
| 0049 | surveys |
| 0050 | workflows |
| 0051 | replay |
| 0052 | platform-security |
| 0053 | warehouse-revenue |
| 0054 | llm-observability |
| 0055 | logs-otlp |
| 0056 | ai-mcp |

No `;` inside SQL comments (the test harness splits statements on `;`).

## Avoiding merge conflicts

- `packages/db/src/schema.ts`: add new tables directly after the related existing table, not at
  the end of the file.
- `apps/api/src/index.ts`: register new routes next to the existing routes of the same feature.
- i18n: add `en-US` and `zh-CN` strings in `apps/dashboard/src/lib/i18n.ts` directly after an
  existing key of your feature (not at the end of the blocks). Put `ja-JP` / `de-DE` / `fr-FR`
  translations for your new keys in `apps/dashboard/scripts/i18n-pending/<stream>.json`
  (`{ "ja-JP": {…}, "de-DE": {…}, "fr-FR": {…} }`). Do not edit `i18n-locale-data.json` or the
  generated `src/lib/locales/*.ts`; the coordinator merges them.
- The tracker script (`handleScript` in `apps/ingest/src/routes/collect.ts`) belongs to the
  tracker-sdk stream only. Others: describe what you need in your final report.
- Avoid new npm dependencies. If one is essential, say why in your report.

## Done means

- `pnpm typecheck` passes and `pnpm test` passes for every package you touched.
- New behavior has tests (API behavior through `fetchWorker*`, pure logic as unit tests).
- User-facing changes are reflected in the Privacy Policy / Terms (`apps/dashboard/src/pages/legal/*`,
  English and Chinese) when they change data handling.
- Do not use the shared browser pane; the coordinator does visual QA after merging.
- Commit your work on your branch with clear messages. Do not push, deploy, or touch production.
- Final report: what you built, files touched, migration used, anything left undone or deferred,
  and anything another stream must know.
