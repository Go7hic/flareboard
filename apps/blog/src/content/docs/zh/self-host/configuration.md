---
title: 配置
description: 自托管 Flareboard 的所有变量、secret 和构建设置，按 Worker 分类并附带默认值。还包括邮件、Google 和 GitHub 登录、SSO 以及 AI 助手的设置方法。
---

本页列出 Flareboard 各个 Worker 的设置。首次部署请按照[自托管 Flareboard](/docs/zh/self-host/deploy)操作，可选部分再回到这里。

## 设置如何生效

- **变量**写在 Worker 的 `wrangler.jsonc` 中 `env.production` 的 `vars` 块里。它们是明文。修改后需要重新部署 Worker 才会生效。
- **Secret** 用 `wrangler secret put NAME --env production` 设置，需要在 Worker 的目录（`apps/api`、`apps/ingest`）中运行。它们不会存入 git。
- **控制台设置**是构建控制台时读取的 `VITE_*` 变量，不是 wrangler 变量。
- **本地开发**读取 `apps/api/.dev.vars` 和 `apps/ingest/.dev.vars`。请从 `.dev.vars.example` 复制。

不要把同一个名称同时设置为变量和 secret。

## API Worker

部署后名为 `flareboard-api-production`。

| 名称 | 类型 | 必填 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `APP_SECRET` | secret | 是 | 无 | 用来签发会话和追踪令牌。采集 Worker 上要使用相同的值。在生产环境中，没有它时 API 会拒绝开启会话。 |
| `ENVIRONMENT` | 变量 | 是 | 顶层为 `development`，`env.production` 中为 `production` | `production` 会开启 HSTS 响应头和带 `Secure`、`SameSite=None` 的会话 cookie，移除 localhost 的 CORS 来源，并且不在日志中记录邮件链接。 |
| `EVENT_STORE` | 变量 | 是 | 仓库配置中为 `do` | 分析数据存放的位置。参见[事件存储](#事件存储)。 |
| `HOSTED_MODE` | 变量 | 否 | 未设置（关闭） | `"true"` 用于把 Flareboard 作为付费服务运行。参见[托管模式](#托管模式)。 |
| `DASHBOARD_URL` | 变量 | 是 | 无 | 控制台的公开源。会作为允许的 CORS 来源，用于验证、重置、报告和告警邮件中的链接，以及 OAuth 登录后的跳转。 |
| `CORS_ORIGINS` | 变量 | 否 | 无 | 以逗号分隔的、允许携带凭据调用 API 的更多控制台来源（`DASHBOARD_URL` 始终被允许）。精确匹配，不带结尾的斜杠。 |
| `SHARE_URL` | 变量 | 否 | 无 | 在登录跳转和计费链接中作为 `DASHBOARD_URL` 的后备。`/api/config` 也会返回它。 |
| `EMAIL_FROM` | 变量 | 用于邮件 | `noreply@flareboard.dev` | 发件地址。它的域名必须已为 Email Sending 配置。请修改它，默认值是托管服务的地址。 |
| `EMAIL_FROM_NAME` | 变量 | 否 | `Flareboard` | 发件人显示名称。 |
| `SSO_SECRET` | secret | 用于 SSO | 无 | `POST /api/auth/sso` 使用的 HMAC secret。参见[单点登录](#单点登录)。 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | secret | 用于 Google 登录 | 无 | 两个都设置才会启用该登录方式。 |
| `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` | secret | 用于 GitHub 登录 | 无 | 两个都设置才会启用该登录方式。 |
| `DEEPSEEK_API_KEY` | secret | 用于 AI 助手 | 无 | 开启“问问 Flareboard”。未设置表示关闭 AI 助手。 |
| `DEEPSEEK_MODEL` | 变量 | 否 | `deepseek-flash` | AI 助手使用的模型。 |
| `DEEPSEEK_BASE_URL` | 变量 | 否 | `https://api.deepseek.com/anthropic` | DeepSeek 端点（Anthropic 消息格式）。 |
| `DEMO_DATA` | 变量 | 否 | 开启 | `off` 会停止为内置示例网站填充数据的生成器（每小时的任务和管理员回填）。 |
| `DEMO_WEBSITE_ID` | 变量 | 否 | 无 | 公开的 `/demo` 控制台展示的网站。会覆盖 slug 为 `demo` 的分享链接。 |
| `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_CLOUD`、`STRIPE_PRICE_BUSINESS` | secret 和一个变量 | 仅托管模式 | 无 | 托管模式的计费。自托管安装请保持未设置。 |

API Worker 还会运行一个每小时的任务（`0 * * * *`）。它会发送定时邮件报告，检查告警规则和错误回归，运行已保存的数据仓库查询和数据源同步，清除超出各网站数据保留设置的数据，并彻底删除超过 30 天前被删除的网站和账户。

## 采集 Worker

部署后名为 `flareboard-ingest-production`。

| 名称 | 类型 | 必填 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `APP_SECRET` | secret | 是 | 无 | 必须与 API Worker 的值相同。 |
| `ENVIRONMENT` | 变量 | 是 | 顶层为 `development`，`env.production` 中为 `production` | 环境名称。 |
| `EVENT_STORE` | 变量 | 是 | `do` | 必须与 API Worker 的值相同。 |
| `HOSTED_MODE` | 变量 | 否 | 未设置（关闭） | 必须与 API Worker 的值相同。为 `"true"` 时，采集端会强制执行套餐额度。 |
| `API_URL` | 变量 | 否 | `http://localhost:8788` | 本地开发时调用 API 的后备地址。生产环境使用指向 `flareboard-api-production` 的 `API` service binding。 |
| `PROJECT_KEY_RATE_LIMIT` | 变量 | 否 | `30000` | 每个项目密钥每分钟允许的请求数。 |
| `DEMO_INGEST` | 变量 | 否 | 未设置 | `on` 会让托管模式的采集端接受内置示例网站的流量。只有开启 `HOSTED_MODE` 时才有意义。 |

## 聚合 Worker

部署后名为 `flareboard-aggregator-production`。它没有 secret。

| 名称 | 类型 | 必填 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `EVENT_STORE` | 变量 | 是 | `do` | 必须与 API Worker 的值相同。 |
| `HOSTED_MODE` | 变量 | 否 | 未设置（关闭） | 必须与 API Worker 的值相同。为 `"true"` 时，计费事件会更新每月用量。 |

## 控制台构建变量

控制台是静态的。这些变量由 `vite build` 读取，所以请在 shell 或你的 Cloudflare 构建环境中设置，然后重新部署。不要提交它们。

| 名称 | 必填 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `VITE_API_URL` | 建议设置 | `https://api.<dashboard-host>`，并去掉开头的 `www.` | API 的源。只要 API 不在 `api.` 加控制台自己主机名的位置，就要设置它。 |
| `VITE_INGEST_URL` | 是 | 无 | 安装代码片段中使用的采集端的源。从不会被猜测。 |
| `VITE_TRACKING_WEBSITE_ID` | 否 | 无 | 控制台用来追踪自身的网站 ID。自托管安装请保持未设置。 |
| `VITE_SITE_URL` | 否 | `https://flareboard.dev` | 用于 canonical 和社交预览 URL 的控制台公开源。请设置为你的控制台地址。 |
| `VITE_MAP_STYLE_URL` | 否 | CARTO Voyager | 世界地图的地图样式 URL。 |
| `VITE_DISABLE_MAPLIBRE_GLOBE` | 否 | 未设置 | `true` 会使用旧的地球渲染器，而不是 MapLibre。 |

可选的博客和文档站点（`apps/blog`）在构建时读取 `PUBLIC_SITE_URL` 和 `PUBLIC_MARKETING_ORIGIN`。自托管安装不需要它。

## 绑定

这些写在 `wrangler.jsonc` 中。你只需要在指向自己的资源时修改它们。

| Worker | 绑定 |
| --- | --- |
| API | `DB`（D1 `flareboard-db`）、`CACHE`（KV）、`REPLAY_BUCKET`（R2 `flareboard-replays`）、`RATE_LIMITER` 和 `SITE_STORE`（Durable Objects `RateLimiter` 和 `EventStore`）、`EMAIL`（Email Sending）、`WORKFLOW_RUNNER`（Workflow）。消费 `flareboard-workflow-triggers`。 |
| 采集 | `DB`、`CACHE`、`REPLAY_BUCKET`、`RATE_LIMITER`、`SITE_STORE`（API Worker 的 `EventStore`）、`EVENT_QUEUE`（`flareboard-events`）、`WORKFLOW_QUEUE`（`flareboard-workflow-triggers`）、`API`（指向 API Worker 的 service binding）。 |
| 聚合 | `DB`、`SITE_STORE`（API Worker 的 `EventStore`）、`DLQ`（`flareboard-events-dlq`）。消费 `flareboard-events` 及其死信队列。 |

## 托管模式

只有付费的 Flareboard Cloud 服务才会把 `HOSTED_MODE` 设为 `"true"`。自托管安装请保持关闭，这样你会得到：

- 没有公开注册。`POST /api/auth/register` 返回 404，`/api/config` 报告 `"registrationEnabled":false`。管理员在**管理**下创建账户。
- 没有计费、套餐限制或用量邮件。所有功能都可用。
- 登录时没有邮箱验证步骤。
- 只有设置了保留期限的网站，原始数据才会按期限清理。没有设置时，数据会一直保留。
- Google 和 GitHub 登录不能创建账户。参见[使用 Google 或 GitHub 登录](#使用-google-或-github-登录)。

请在 API、采集和聚合 Worker 上设置相同的值。

## 事件存储

`EVENT_STORE` 决定分析数据写到哪里、从哪里读取。API、采集和聚合 Worker 必须始终使用相同的值。

| 值 | 写入 | 读取 |
| --- | --- | --- |
| `do` | 每个网站一个 `EventStore` Durable Object | 该网站的存储 |
| `dual` | 先写 D1，再写该网站的存储 | D1 |
| `d1` | D1 | D1 |

新安装请使用 `do`。`d1` 是旧模式，当变量未设置或为其他任何值时，代码会回退到它。`dual` 用于把旧安装从 D1 迁移到 Durable Objects：开启期间，API 每小时的任务会把历史数据复制到各个存储中。

## 邮件

Flareboard 通过 Cloudflare Email Sending 发送邮件。它用于密码重置链接、定时邮件报告、用量和告警通知，以及工作流的邮件步骤。

1. 在你的域名上启用 [Email Sending](https://developers.cloudflare.com/email-routing/email-workers/send-email/)，并验证发件域名（SPF 和 DKIM）。
2. 在 `apps/api/wrangler.jsonc` 中保留名为 `EMAIL` 的 `send_email` 绑定。
3. 把 `EMAIL_FROM`（以及可选的 `EMAIL_FROM_NAME`）设为该域名下的地址，并设置 `DASHBOARD_URL`，让邮件中的链接指向你的控制台。
4. 部署 API Worker。

没有 `EMAIL` 绑定就不会投递任何邮件。在生产环境中，API 只记录某封邮件发送失败，不会记录邮件内容或其中的链接。

## 使用 Google 或 GitHub 登录

1. 在服务提供方创建一个 OAuth 应用。使用下面的回调 URL，并换成你的 API 主机：
   - Google：`https://YOUR_API_HOST/api/auth/oauth/google/callback`
   - GitHub：`https://YOUR_API_HOST/api/auth/oauth/github/callback`
2. 在 API Worker 上设置该提供方的两个 secret：

   ```bash
   cd apps/api
   pnpm exec wrangler secret put GITHUB_CLIENT_ID --env production
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --env production
   ```

   Google 则使用 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。
3. 登录页面随后会提供**使用 GitHub 登录**或**使用 Google 登录**。只有某个提供方的两个 secret 都设置了，它才会启用。

在自托管安装上，登录提供方只能登录已有的账户。它适用于已关联该提供方的账户，或者邮箱已验证且与提供方已验证的邮箱一致的账户。已登录的用户可以在其账户安全页面的**登录方式**部分关联提供方。除非开启 `HOSTED_MODE`，否则不会通过 OAuth 创建新账户。

## 单点登录

SSO 让另一个系统用一个短期有效的签名令牌，不需要密码就能让用户登录。

1. 设置 secret。使用与 `APP_SECRET` 不同的值：

   ```bash
   cd apps/api
   pnpm exec wrangler secret put SSO_SECRET --env production
   ```

2. 在仓库中的脚本里，为一个已有用户生成令牌。它在 5 分钟后过期。

   ```ts
   import { createSsoToken } from '@flareboard/shared';

   const token = createSsoToken({ userId: 'USER_ID', role: 'user' }, process.env.SSO_SECRET!);
   console.log(token);
   ```

3. 用它换取会话。响应的格式与登录相同，包含 `token` 和 `user`。

   ```bash
   curl -X POST https://api.YOUR_DOMAIN/api/auth/sso \
     -H 'Content-Type: application/json' \
     -d '{"token":"YOUR_SSO_TOKEN"}'
   ```

在生产环境中，没有 `SSO_SECRET` 时该端点返回 503 `SSO is not configured`。

## AI 助手

“问问 Flareboard”可以回答关于某个网站数据的问题。设置密钥即可开启：

```bash
cd apps/api
pnpm exec wrangler secret put DEEPSEEK_API_KEY --env production
```

没有该密钥时，AI 助手处于关闭状态。它会调用 DeepSeek。你的提问、网站的名称、域名和时区，以及助手查询到的数据都会发送给 DeepSeek，存储在中国，并且可能被 DeepSeek 用于改进其模型。启用之前，请先判断这是否符合你的隐私要求。在自托管安装上，没有每日提问次数限制。

## 计费

Stripe 设置（`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_CLOUD`、`STRIPE_PRICE_BUSINESS`）属于托管模式。`HOSTED_MODE` 关闭时，计费端点返回 404 `Billing is not enabled`。请保持它们未设置。

把 Stripe 连接为用于收入报表的数据源是另一项功能。它的受限密钥在控制台中填写，加密存储，不是环境变量。

## 本地开发

本地运行使用 `.dev.vars` 文件：

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/ingest/.dev.vars.example apps/ingest/.dev.vars
```

示例文件中设置了 `HOSTED_MODE=false`。两个文件里请使用相同的 `APP_SECRET`。开发时控制台不需要 `.env`：它的开发服务器会把 `/api/` 转发到 `http://localhost:8788` 上的 API Worker，安装代码片段则使用 `http://localhost:8787` 作为采集端。
