# Storage migration: shared D1 → one Durable Object per website

Analytics tables (`SITE_TABLES` in `apps/api/src/lib/site-db.ts`: events, sessions, replays,
heatmaps, rollups, people, warehouse imports) move out of the shared D1 database into one
SQLite-backed `EventStore` Durable Object per website (`site:<websiteId>`, class in
`apps/api/src/store/event-store.ts`). D1 keeps configuration only (users, websites, flags,
cohorts, …).

Every writer and reader picks its target from the `EVENT_STORE` variable:

| Mode   | Writes                                   | Reads      |
|--------|------------------------------------------|------------|
| `d1`   | D1                                       | D1         |
| `dual` | D1, then the website store (best effort) | D1         |
| `do`   | website store                            | the store  |

The three workers must always run the **same mode**: the API (`apps/api/wrangler.jsonc`), the
aggregator (`workers/aggregator/wrangler.jsonc`) and ingest (`apps/ingest/wrangler.jsonc`).
Local development and tests use `do`. Production starts at `d1`.

## Before you start

- Deploy everything with production still at `EVENT_STORE: "d1"`. Deploy the **API first**: it
  defines the `EventStore` class (migration tag `v2-event-store`). The aggregator and ingest bind
  to it with `script_name: "flareboard-api-production"` and fail to deploy if it does not exist.
- Check that `GET /api/admin/storage` (admin login) answers with `"mode": "d1"`.
- Note the D1 size (`wrangler d1 info flareboard-db --env production`) and event counts per
  website for later comparison.
- Take a D1 backup (Time Travel bookmark): `wrangler d1 time-travel info flareboard-db --env production`.

## 1. Dual writes

Set `EVENT_STORE: "dual"` in the production `vars` of all three workers and deploy them: API,
then aggregator, then ingest.

From now on every new event, session, person and replay chunk is written to D1 and to the
website's store. Readers still use D1, so the dashboard does not change. A failed store write
is logged (`queue_dual_write_failed`, `ingest_dual_write_failed`) and filled in by the backfill.

## 2. Backfill history

The hourly cron (`runStoreBackfill`, only active in `dual`) copies history for five websites per
tick, 5,000 rows per website per tick. Progress per website is kept in KV
(`store-backfill:<websiteId>`), every copy is idempotent (`INSERT OR IGNORE`, people and imports
`INSERT OR REPLACE`, heatmap cells keep the larger count), and when a website's last table is
copied its rollups are rebuilt from the copied events.

Large websites finish faster by running chunks by hand (10,000 rows per call):

```bash
# ADMIN_COOKIE: the `flareboard_session` cookie of an admin login
until curl -s -X POST https://api.flareboard.dev/api/admin/storage/backfill \
  -H "Cookie: flareboard_session=$ADMIN_COOKIE" -H 'Content-Type: application/json' \
  -d '{"websiteId":"<websiteId>"}' | grep -q '"done":true'; do sleep 1; done
```

An admin's personal API key with the `write` scope works too (`-H "Authorization: Bearer fb_sk_…"`).
Pass `"restart": true` once to copy a website again from the beginning.

## 3. Verify

```bash
curl -s "https://api.flareboard.dev/api/admin/storage?verify=1" -H "Cookie: flareboard_session=$ADMIN_COOKIE"
```

For every website `backfill.done` must be `true` and `verification.complete` must be `true`:
each table has at least as many rows in the store as in D1 (the store may have more, because
events arriving during `dual` are written to both). Also compare a few dashboards against the
numbers you noted: open a website, read its store-side totals with the rollup rebuild below if
anything looks off.

Do not continue while a website is incomplete. Run its backfill with `"restart": true`, then
verify again.

## 4. Switch reads and writes to the stores

Set `EVENT_STORE: "do"` in all three workers and deploy them in the same order (API, aggregator,
ingest), within a few minutes of each other. Between the API deploy and the last worker, a few
events may still be written to D1 only; the next step covers them.

Then rebuild every website's rollups once, so events that arrived during the switch are counted:

```bash
curl -s -X POST https://api.flareboard.dev/api/admin/storage/rebuild-rollups \
  -H "Cookie: flareboard_session=$ADMIN_COOKIE" -H 'Content-Type: application/json' -d '{}'
```

Check the dashboards again. If anything is wrong, **roll back** by setting all three workers to
`dual` (D1 has everything up to the switch, and dual keeps both copies current) and investigate.

To catch events written to D1 only during the switch, run one more backfill pass per website
with `"restart": true` (idempotent, copies only missing rows), then rebuild rollups again.

## 5. Drop the analytics tables from D1

Wait at least one week in `do` with no rollback. Then add a D1 migration that drops the
`SITE_TABLES` tables (and their views/indexes) from the shared database, and remove the `dual`
backfill code path if it is no longer needed. The per-website purge in
`apps/api/src/lib/data-deletion.ts` already erases the store (`EventStore.erase()`), so
deletion keeps working.

## Operations after the migration

- **Size and limits:** one store per website, 10 GB each; the API's `GET /api/admin/storage`
  lists every website's state. Retention (`lib/retention.ts`) runs per store.
- **Rollups:** `POST /api/admin/storage/rebuild-rollups` with `{"websiteId": "…"}` rebuilds one
  website's rollups from its events at any time (same rules as the aggregator, covered by
  `test/lib/store-rollups-parity.spec.ts`).
- **Heatmap dedup ids** are purged by the store's own alarm (older than two days).
- **Schema changes** to site tables go into `STORE_MIGRATIONS` in `apps/api/src/store/schema.ts`
  (applied lazily when a store is first used after deploy), not into D1 migrations.
