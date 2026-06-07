# @flareboard/db

Drizzle schema and D1 SQL migrations in `migrations/`.

## Migrations

| File | Purpose |
|------|---------|
| `0000_initial.sql` | Core analytics schema |
| `0001_audit_log.sql` | Admin audit log |
| `0002_performance_indexes.sql` | Hot-path indexes on `website_event`, `event_data`, `session_data`, `session_replay` |
| `0003_rollups.sql` | Rollup read-model tables + `session_replay_summary` |

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
