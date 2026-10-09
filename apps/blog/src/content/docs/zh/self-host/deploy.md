---
title: 自托管 Flareboard
sidebarTitle: 部署
description: 把 Flareboard 部署到你自己的 Cloudflare 账户，从克隆代码到首次登录。涵盖许可证、所需条件、要创建的资源、要修改的配置，以及如何检查结果。
---

Flareboard 以一组 Cloudflare Worker 的形式运行，并使用 D1、R2、KV、Queues 和 Durable Objects，全部位于你自己的 Cloudflare 账户中。本页带你从全新克隆一路到可用的安装。

其他页面中出现的 Cloud 地址（`https://flareboard.dev`、`https://api.flareboard.dev`、`https://t.flareboard.dev`），请换成你自己的控制台、API 和采集地址。

## 许可证

Flareboard 以 [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) 提供源码。

- 个人、教育及其他非商业用途免费。
- 商业用途需要单独的许可。请写信到 [hello@flareboard.dev](mailto:hello@flareboard.dev)。
- 浏览器 SDK `@flareboard/js` 使用 MIT 许可证，可以用在任何站点上。

自托管安装拥有全部功能，没有套餐限制。

## 开始之前

- 一个 Cloudflare 账户。仓库的部署指南要求使用 Workers 付费套餐，因为 Queues 和 D1 有相应限制。
- 一个可以指向 Workers 的域名。你需要三个主机名：控制台、API 和采集端点各一个。本页使用 `dashboard.YOUR_DOMAIN`、`api.YOUR_DOMAIN` 和 `t.YOUR_DOMAIN`。
- Node.js 20 或更高版本，以及 pnpm 9（仓库固定为 `pnpm@9.15.0`）。
- 一个可以对你的账户运行 `wrangler` 的终端。

## 整体结构

| 组成部分 | 作用 |
| --- | --- |
| 控制台 Worker | 以静态资源的形式提供控制台。 |
| API Worker | REST API、登录、设置、MCP 服务器、定时任务和工作流。导出 `EventStore` 和 `RateLimiter` 两个 Durable Object。 |
| 采集 Worker | 接收事件、回放分块、开关和问卷请求。提供 `script.js` 和 `recorder.js`。 |
| 聚合 Worker | 消费事件队列，写入事件、会话和汇总数据。 |
| D1 | 账户、网站、配置和用量。 |
| Durable Objects | 每个网站一个基于 SQLite 的 `EventStore`，保存该网站的分析数据。`RateLimiter` 限制公开端点。 |
| R2 | 会话回放分块。 |
| KV | 实时计数器和 API 响应缓存。 |
| Queues | `flareboard-events` 把事件从采集端送到聚合端。`flareboard-workflow-triggers` 把工作流触发器从采集端送到 API。每个队列都有一个死信队列。 |
| Workflows | Cloudflare Workflows 在 API Worker 中运行工作流执行（延迟、条件、webhook、邮件和 Slack 步骤）。 |

## 1. 克隆并安装

```bash
git clone https://github.com/Go7hic/flareboard.git
cd flareboard
pnpm install
pnpm exec wrangler login
```

## 2. 创建 Cloudflare 资源

请保持这些名称不变，`wrangler.jsonc` 文件会引用它们。

```bash
pnpm exec wrangler d1 create flareboard-db
pnpm exec wrangler kv namespace create flareboard-cache
pnpm exec wrangler r2 bucket create flareboard-replays
pnpm exec wrangler queues create flareboard-events
pnpm exec wrangler queues create flareboard-events-dlq
pnpm exec wrangler queues create flareboard-workflow-triggers
pnpm exec wrangler queues create flareboard-workflow-triggers-dlq
```

Wrangler 会打印 D1 的 `database_id` 和 KV 命名空间的 `id`。请记下它们，下一步要用。Durable Object 类和工作流不需要单独的步骤，`wrangler deploy` 会创建它们。

## 3. 让配置指向你自己的资源

仓库中的 `env.production` 配置块包含 Flareboard 自己的资源 ID 和托管服务的设置。部署前请修改它们。`pnpm validate:wrangler` 只会检查 `REPLACE_WITH_*` 占位符，所以发现不了遗留的 ID。

在每个文件的 `env.production` 中：

| 文件 | 修改内容 |
| --- | --- |
| `apps/api/wrangler.jsonc` | 把 `d1_databases[0].database_id` 改为 `YOUR_D1_DATABASE_ID`，把 `kv_namespaces[0].id` 改为 `YOUR_KV_NAMESPACE_ID`，并修改下面的 `vars`。 |
| `apps/ingest/wrangler.jsonc` | 同样的 `database_id` 和 KV `id`。按下文设置 `HOSTED_MODE`。 |
| `workers/aggregator/wrangler.jsonc` | 同样的 `database_id`。按下文设置 `HOSTED_MODE`。 |

在这三个文件中，把 `HOSTED_MODE` 设为 `"false"`（或删除这一行）。`"true"` 会开启公开注册、计费和套餐限制，自托管安装不需要这些。参见[配置](/docs/zh/self-host/configuration#托管模式)。

在 `apps/api/wrangler.jsonc` 中，把生产环境的 `vars` 设为你自己的地址。删除 `STRIPE_PRICE_BUSINESS`，它是托管服务的 Stripe 价格。

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "EVENT_STORE": "do",
  "HOSTED_MODE": "false",
  "EMAIL_FROM": "noreply@YOUR_DOMAIN",
  "EMAIL_FROM_NAME": "Flareboard",
  "DASHBOARD_URL": "https://dashboard.YOUR_DOMAIN",
  "CORS_ORIGINS": "https://dashboard.YOUR_DOMAIN"
}
```

三个 Worker 中的 `EVENT_STORE` 都保持为 `"do"`，它们必须始终使用相同的值。`DASHBOARD_URL` 和 `CORS_ORIGINS` 必须与控制台的源完全一致：协议加主机，不带结尾的斜杠。

## 4. 应用数据库迁移

```bash
pnpm db:migrate:remote
```

它会把 `packages/db/migrations` 中的每个文件应用到 D1 数据库。在仓库根目录运行时，它等同于：

```bash
wrangler d1 migrations apply flareboard-db --remote --env production --config apps/api/wrangler.jsonc
```

## 5. 部署 API、聚合 Worker 和采集 Worker

先部署 API。它定义了 `EventStore` Durable Object 类。聚合 Worker 和采集 Worker 通过 API Worker 绑定到这个类，如果它还不存在，它们的部署会失败。采集 Worker 还有一个指向 API Worker 的 service binding。

```bash
pnpm deploy:api
pnpm deploy:aggregator
pnpm deploy:ingest
```

每个脚本都会先检查生产配置中是否还有 `REPLACE_WITH_*` 占位符，然后运行 `wrangler deploy --env production`。这些 Worker 的名称是 `flareboard-api-production`、`flareboard-aggregator-production` 和 `flareboard-ingest-production`。

## 6. 设置 secret

`APP_SECRET` 用来签发会话和追踪令牌。请在 API 和采集 Worker 上使用同一个足够长的随机值。

```bash
cd apps/api
pnpm exec wrangler secret put APP_SECRET --env production
cd ../ingest
pnpm exec wrangler secret put APP_SECRET --env production
cd ../..
```

没有真实的 `APP_SECRET` 时，API 在生产环境中会拒绝签发会话。可选的 secret（OAuth、SSO、AI 助手）列在[配置](/docs/zh/self-host/configuration)中。

## 7. 添加自定义域名

在 Cloudflare 控制台中打开每个 Worker，依次进入 **Settings**、**Domains & Routes**，然后添加自定义域名。

| 主机名 | Worker |
| --- | --- |
| `dashboard.YOUR_DOMAIN`（或根域名） | `flareboard-dashboard` |
| `api.YOUR_DOMAIN` | `flareboard-api-production` |
| `t.YOUR_DOMAIN` | `flareboard-ingest-production` |

聚合 Worker 是队列消费者，不需要主机名。`flareboard-dashboard` Worker 在第 8 步之后才存在，所以到那时再为它添加域名。

全程使用 HTTPS。在生产环境中，会话 cookie 带有 `Secure` 和 `SameSite=None`，所以控制台无法通过普通 HTTP 登录。

## 8. 构建并部署控制台

控制台会在构建时写死它的 API 和采集地址。请在运行构建的 shell 中设置它们：

```bash
VITE_API_URL=https://api.YOUR_DOMAIN \
VITE_INGEST_URL=https://t.YOUR_DOMAIN \
pnpm deploy:dashboard
```

请明确设置 `VITE_API_URL`。如果缺失，控制台会猜测 `https://api.<dashboard-host>`，这对位于 `dashboard.YOUR_DOMAIN` 的控制台是错的。`VITE_INGEST_URL` 是必需的：它从不会被猜测，没有它，安装代码片段就无法发送数据。不要提交这些值。其他构建变量见[配置](/docs/zh/self-host/configuration#控制台构建变量)。

## 9. 创建第一个管理员

```bash
pnpm seed:remote -- --username YOUR_ADMIN_NAME --password 'YOUR_PASSWORD'
```

必须提供密码，脚本会拒绝开发环境的默认密码 `flareboard`。自托管安装关闭了公开注册，所以这就是第一个账户。之后要创建更多账户：登录后打开**管理**，点击**创建用户**。

## 检查是否生效

1. API 有响应。打开或用 `curl` 请求 `https://api.YOUR_DOMAIN/api/heartbeat`。你应该得到 `{"ok":true,"service":"flareboard-api","environment":"production"}`。
2. 采集端有响应。`https://t.YOUR_DOMAIN/api/heartbeat` 返回 `{"ok":true}`。`https://t.YOUR_DOMAIN/script.js` 返回 JavaScript。
3. API 运行在自托管模式。`https://api.YOUR_DOMAIN/api/config` 应当包含 `"hosted":false` 和 `"registrationEnabled":false`。
4. 打开 `https://dashboard.YOUR_DOMAIN`，用第 9 步创建的管理员账户登录。
5. 打开**网站**，点击**添加网站**，复制安装代码片段。它应当指向 `https://t.YOUR_DOMAIN/script.js`。
6. 把代码片段安装到某个页面并加载它，然后在该网站的设置中点击**测试连接**。接着打开**实时**。详细步骤见[快速开始](/docs/zh/quickstart)的第 3 步。

## 故障排查

| 现象 | 原因 | 解决方法 |
| --- | --- | --- |
| 点击登录没有反应，浏览器控制台显示 CORS 错误 | `DASHBOARD_URL` 和 `CORS_ORIGINS` 与控制台的源不一致 | 在 `apps/api/wrangler.jsonc` 中改正，并运行 `pnpm deploy:api`。 |
| 控制台提示 API 返回了 HTML 而不是 JSON | `VITE_API_URL` 缺失或错误，请求打到了控制台 Worker | 用正确的 `VITE_API_URL` 重新构建（第 8 步）。 |
| 安装代码片段提示缺少采集地址 | 控制台构建时没有设置 `VITE_INGEST_URL` | 带上它重新构建（第 8 步）。 |
| 部署聚合 Worker 或采集 Worker 时在 `SITE_STORE` 绑定上失败 | API Worker 还没有部署 | 先运行 `pnpm deploy:api`。 |
| 部署时在数据库或 KV 绑定上失败 | `env.production` 中的 ID 还属于别人 | 替换它们（第 3 步）。 |

关于追踪问题的更多内容：[故障排查](/docs/zh/troubleshooting)。之后要更新安装，参见[升级](/docs/zh/self-host/upgrade)。
