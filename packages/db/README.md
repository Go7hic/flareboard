# @flareboard/db

Drizzle schema and D1 SQL migrations in `migrations/`.

## Migrations

| File | Purpose |
|------|---------|
| `0000_initial.sql` | Core analytics schema |
| `0001_audit_log.sql` | Admin audit log |
| `0002_performance_indexes.sql` | Hot-path indexes on `website_event`, `event_data`, `session_data`, `session_replay` |
| `0003_rollups.sql` | Rollup read-model tables + `session_replay_summary` |
| `0004_hosted_billing.sql` | Hosted Cloud billing plans and subscriptions |
| `0005_gap_features.sql` | Website analytics gap tables for goals, heatmaps, cohorts, and report metadata |
| `0006_gap_features_full.sql` | Additional analytics and collaboration tables for reports, boards, teams, and imports |
| `0007_goals.sql` | Goal definitions and progress tracking |
| `0008_rollup_session_visit_granularity.sql` | Session rollup granularity updates |
| `0009_feature_flags.sql` | Feature flag definitions for gradual rollout and experiments |
| `0010_experiments.sql` | Experiment definitions linked to feature flags and goal events |
| `0011_surveys.sql` | In-product surveys and session-linked responses |
| `0012_workflows.sql` | Event-triggered workflow rules and execution history |
| `0013_survey_options.sql` | Choice/rating survey options |
| `0014_feature_flag_targeting.sql` | Feature flag targeting rules and variants |
| `0015_survey_triggers.sql` | Survey trigger and display timing fields |
| `0016_error_issue_state.sql` | Error issue grouping and status state |
| `0017_action_definitions.sql` | PostHog-style action definitions and rule metadata |
| `0018_annotations.sql` | Timeline annotations for releases, incidents, campaigns, and experiments |
| `0019_insights.sql` | Saved insight definitions for trend, funnel, retention, path, stickiness, and table views |
| `0020_error_issue_workflow.sql` | Error issue comments and workflow metadata |
| `0021_error_source_maps.sql` | Uploaded source map metadata for error tracking |
| `0022_error_alert_rules.sql` | Error alert rules and alert event history |
| `0023_log_saved_filters.sql` | Saved log filters |
| `0024_log_alert_rules.sql` | Log alert rules and alert event history |
| `0025_survey_display_rules.sql` | Survey display rules |
| `0026_warehouse_saved_queries.sql` | Warehouse saved SQL queries |
| `0027_warehouse_query_history.sql` | Warehouse query history |
| `0028_warehouse_scheduled_queries.sql` | Warehouse scheduled queries |
| `0029_warehouse_data_sources.sql` | Warehouse external data source metadata |
| `0030_people.sql` | Person/group identity tables with unique `(website_id, distinct_id)` |
| `0031_warehouse_import.sql` | Imported warehouse rows from external data sources |
| `0032_share_expiry.sql` | Optional `share.expires_at` for expiring public share links |
| `0033_user_token_version.sql` | `user.token_version` for session revocation on password change |
| `0034_dead_event.sql` | `dead_event` table for retry-exhausted queue messages |
| `0035_website_retention.sql` | Opt-in `website.retention_days` for raw-data purge |
| `0036_rollup_series_bucket.sql` | Per-bucket session/visit identities for visitor & visit time series |

## Deletion model

Websites are **soft-deleted** (`website.deleted_at`); child rows (events, sessions, feature flags, surveys, people, warehouse data, …) are intentionally kept and foreign keys do not declare `ON DELETE CASCADE`. Any future hard-delete/purge job must delete child tables explicitly before removing `website` rows.

Raw event retention is opt-in per website via `website.retention_days`. When set, the API worker's hourly cron (`runRetentionPurge`) deletes `event_data`, `revenue`, `session_replay`, `session_data`, and `website_event` rows older than the window, child-before-parent, bounded per tick. Null keeps data forever (the default).

Apply via the API worker wrangler config (paths are relative to `apps/api/wrangler.jsonc`):

```bash
pnpm db:migrate          # local D1
pnpm db:migrate:remote   # remote D1 (production env)
```

Remote apply requires `env.production.d1_databases[].migrations_dir` set to `../../packages/db/migrations` in `apps/api/wrangler.jsonc` (and matching entries on ingest/aggregator for consistency).

## Rollup backfill

After `0003_rollups` on a database with existing events, rebuild rollup counters from raw data:

```bash
pnpm backfill:rollups              # local
pnpm backfill:rollups -- --remote  # production (--env production applied automatically)
pnpm backfill:rollups -- --remote --website=<uuid>   # single site
```

New events maintain rollups incrementally in the aggregator worker; backfill is only needed for historical data or repair.
