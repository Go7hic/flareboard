---
title: 升级
description: 把自托管的 Flareboard 更新到新版本。拉取代码、查看变更、应用数据库迁移、按正确顺序重新部署，必要时回滚。
---

升级自托管的 Flareboard 需要拉取新代码、应用新的数据库迁移，然后重新部署 Worker。推送代码不会运行迁移，也不会创建队列，这些步骤需要你自己完成。

## 开始之前

- 你的 `wrangler.jsonc` 文件中包含你自己的 D1 和 KV ID 以及设置（参见[自托管 Flareboard](/docs/zh/self-host/deploy#3-让配置指向你自己的资源)）。请把这些改动放在你克隆仓库的一个分支上，这样合并上游变更时不会丢失它们。
- 准备好同样的控制台构建变量（`VITE_API_URL`、`VITE_INGEST_URL`）。每次升级都会重新构建控制台。
- 记下你当前运行的版本。仓库会给发布打标签（例如 `v1.2.0`）。

## 1. 拉取新版本

```bash
git fetch --tags origin
git merge origin/main
pnpm install
```

如果想停留在某个发布版本，请合并 `v1.2.0` 这样的标签，而不是 `origin/main`。如果合并时 `wrangler.jsonc` 出现冲突，请保留你的 ID 和变量，并在它们周围采用上游的变更。

## 2. 查看变更内容

仓库没有变更日志文件。请使用新旧版本之间的 git 历史：

```bash
git log --oneline OLD_VERSION..HEAD
git diff --stat OLD_VERSION..HEAD -- packages/db/migrations apps/api/wrangler.jsonc apps/ingest/wrangler.jsonc workers/aggregator/wrangler.jsonc
```

把 `OLD_VERSION` 替换为你之前运行的标签或提交。重点关注：

- **`packages/db/migrations` 中的新文件。** 你要在第 4 步应用它们。
- **`wrangler.jsonc` 中的变更。** 新的绑定、队列、变量或 Durable Object 迁移，可能需要你提供资源或设置。先创建新的队列、KV 命名空间或存储桶，再把新条目复制到你的配置中。
- **`docs/deployment.md` 以及本部分页面的变更。**

各网站存储内部的分析数据表则不同。它们的表结构变更会在 API 部署之后、存储第一次被使用时自动应用，所以不需要迁移命令。

## 3. 保存一个恢复点

修改数据库之前，先记录一个 D1 Time Travel 书签：

```bash
pnpm exec wrangler d1 time-travel info flareboard-db --env production --config apps/api/wrangler.jsonc
```

保留它打印出的书签。

## 4. 应用数据库迁移

```bash
pnpm db:migrate:remote
```

在仓库根目录运行时，它等同于 `wrangler d1 migrations apply flareboard-db --remote --env production --config apps/api/wrangler.jsonc`。它只会应用你的数据库还没有的迁移，数据库已是最新时什么也不做。请在部署需要新表的代码之前运行它。

## 5. 部署 Worker

按这个顺序部署。API 排在最前，因为另外两个 Worker 绑定到它的 `EventStore` 类。

```bash
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

然后用你的地址重新构建并部署控制台：

```bash
VITE_API_URL=https://api.YOUR_DOMAIN \
VITE_INGEST_URL=https://t.YOUR_DOMAIN \
pnpm deploy:dashboard
```

secret 和自定义域名保持不变。只有当第 2 步的 diff 新增了 secret 时，才需要再次设置。各项设置列在[配置](/docs/zh/self-host/configuration)中。

## 检查是否生效

1. `https://api.YOUR_DOMAIN/api/heartbeat` 返回 `{"ok":true,...}`，`https://t.YOUR_DOMAIN/api/heartbeat` 返回 `{"ok":true}`。
2. 登录控制台并打开一个网站。最近一小时的数字应当与之前看起来一致。
3. 加载一个装有追踪脚本的页面，然后打开该网站的**实时**。你的访问会在几秒内出现。
4. 在 Cloudflare 控制台中检查，`flareboard-events` 队列没有持续增长的积压，`flareboard-events-dlq` 为空。

## 回滚

代码和数据库要分别回滚。

**Worker。** 检出之前的版本，安装依赖，然后按与第 5 步相同的顺序重新部署：

```bash
git checkout OLD_VERSION
pnpm install
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

从同一个检出重新构建控制台。你也可以在某个 Worker 的目录中运行 `pnpm exec wrangler rollback --env production`，让该 Worker 回到它之前部署的版本。

**数据库。** 重新部署旧代码不会撤销迁移。旧代码通常可以在多出几张表的数据库上正常工作。如果迁移本身出了问题，请用 `wrangler d1 time-travel restore flareboard-db --bookmark=YOUR_BOOKMARK --env production --config apps/api/wrangler.jsonc` 把 D1 恢复到第 3 步的书签。恢复会丢弃书签之后写入 D1 的所有内容，包括新账户和设置，所以只在必须时使用。

各网站的分析数据存放在 Durable Objects 中，而不是 D1，不受 D1 恢复的影响。

## 故障排查

| 现象 | 原因 | 解决方法 |
| --- | --- | --- |
| 页面报错，提示缺少表或列 | 没有应用迁移 | 运行 `pnpm db:migrate:remote`，然后刷新。 |
| 部署在 `SITE_STORE` 上失败 | API Worker 比其他 Worker 所期望的更旧，或尚未部署 | 先部署 API。 |
| 部署在队列或存储桶上失败 | 这个版本新增了一个你还没有创建的资源 | 用 `wrangler queues create` 或 `wrangler r2 bucket create` 创建它，名称与配置中的一致。 |
| 控制台显示的还是旧界面 | 控制台没有重新构建 | 在设置好 `VITE_*` 变量的情况下运行 `pnpm deploy:dashboard`。 |
