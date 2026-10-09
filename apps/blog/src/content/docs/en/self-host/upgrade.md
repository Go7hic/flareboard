---
title: Upgrade
description: Update a self-hosted Flareboard to a newer version. Pull the code, check what changed, apply database migrations, redeploy in the right order, and roll back if needed.
---

A self-hosted Flareboard is updated by pulling the new code, applying any new database migrations, and deploying the workers again. Pushing code never runs migrations or creates queues, so do those steps yourself.

## Before you start

- Your `wrangler.jsonc` files contain your own D1 and KV IDs and settings (see [Self-host Flareboard](/docs/self-host/deploy#3-point-the-config-at-your-resources)). Keep those changes in a branch of your clone so you can merge upstream changes without losing them.
- Have the same dashboard build variables ready (`VITE_API_URL`, `VITE_INGEST_URL`). The dashboard is rebuilt on every upgrade.
- Note the version you run now. The repository tags releases (for example `v1.2.0`).

## 1. Pull the new version

```bash
git fetch --tags origin
git merge origin/main
pnpm install
```

To stay on a release, merge a tag such as `v1.2.0` instead of `origin/main`. If the merge conflicts in a `wrangler.jsonc`, keep your IDs and variables and take the upstream changes around them.

## 2. Read what changed

The repository has no changelog file. Use the git history between your old and new versions:

```bash
git log --oneline OLD_VERSION..HEAD
git diff --stat OLD_VERSION..HEAD -- packages/db/migrations apps/api/wrangler.jsonc apps/ingest/wrangler.jsonc workers/aggregator/wrangler.jsonc
```

Replace `OLD_VERSION` with the tag or commit you were running. Look for:

- **New files in `packages/db/migrations`.** You apply these in step 4.
- **Changes in a `wrangler.jsonc`.** A new binding, queue, variable or Durable Object migration may need a resource or a setting from you. Create new queues, KV namespaces or buckets first, then copy the new entries into your config.
- **Changes to `docs/deployment.md`** and to the pages in this section.

Analytics tables inside the per-website stores are different. Their schema changes are applied automatically the first time a store is used after the API deploy, so they need no migration command.

## 3. Take a restore point

Record a D1 Time Travel bookmark before you change the database:

```bash
pnpm exec wrangler d1 time-travel info flareboard-db --env production --config apps/api/wrangler.jsonc
```

Keep the bookmark it prints.

## 4. Apply the database migrations

```bash
pnpm db:migrate:remote
```

From the repository root, this is the same as `wrangler d1 migrations apply flareboard-db --remote --env production --config apps/api/wrangler.jsonc`. It applies only the migrations your database does not have yet, and does nothing when it is up to date. Run it before you deploy code that needs the new tables.

## 5. Deploy the workers

Deploy in this order. The API comes first because the other two bind to its `EventStore` class.

```bash
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

Then rebuild and deploy the dashboard with your addresses:

```bash
VITE_API_URL=https://api.YOUR_DOMAIN \
VITE_INGEST_URL=https://t.YOUR_DOMAIN \
pnpm deploy:dashboard
```

Secrets and custom domains stay as they are. Only set a secret again if the diff in step 2 adds a new one. The settings are listed in [Configuration](/docs/self-host/configuration).

## Check that it works

1. `https://api.YOUR_DOMAIN/api/heartbeat` returns `{"ok":true,...}` and `https://t.YOUR_DOMAIN/api/heartbeat` returns `{"ok":true}`.
2. Sign in to the dashboard and open a website. The numbers for the last hour should look like they did before.
3. Load a page that has the tracking script, then open **Realtime** for that website. Your visit appears within a few seconds.
4. In the Cloudflare dashboard, check that the `flareboard-events` queue has no growing backlog and `flareboard-events-dlq` is empty.

## Roll back

Code and database roll back separately.

**Workers.** Check out the previous version, install, and deploy again in the same order as step 5:

```bash
git checkout OLD_VERSION
pnpm install
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

Rebuild the dashboard from the same checkout. You can also run `pnpm exec wrangler rollback --env production` inside a worker's directory to return that worker to its previous deployed version.

**Database.** Redeploying old code does not undo migrations. Older code usually works with a database that has extra tables. If a migration itself went wrong, restore D1 to the bookmark from step 3 with `wrangler d1 time-travel restore flareboard-db --bookmark=YOUR_BOOKMARK --env production --config apps/api/wrangler.jsonc`. A restore discards everything written to D1 after the bookmark, including new accounts and settings, so use it only when you must.

Per-website analytics live in Durable Objects, not D1, and are not affected by a D1 restore.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| A page errors with a missing table or column | The migrations were not applied | Run `pnpm db:migrate:remote`, then reload. |
| Deploy fails on `SITE_STORE` | The API worker is older than the one the others expect, or not deployed | Deploy the API first. |
| Deploy fails on a queue or bucket | The release added a resource you have not created | Create it with `wrangler queues create` or `wrangler r2 bucket create`, matching the name in the config. |
| The dashboard shows the old interface | The dashboard was not rebuilt | Run `pnpm deploy:dashboard` with the `VITE_*` variables set. |
