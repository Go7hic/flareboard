---
title: REST API
description: 用个人 API 密钥，在你自己的代码中读取 Flareboard 分析数据并管理功能开关。包括基础 URL、认证、接口、分页、错误和限制。
---

Flareboard REST API 就是控制台所使用的 API。有了个人 API 密钥，你可以在脚本、仪表盘和其他工具中列出网站、读取统计数据、事件、会话和用户、运行 SQL、导出 CSV，以及修改功能开关。要把事件发送到 Flareboard，请改用采集接口（见 [采集 API](/docs/zh/reference/ingest-api)）。要通过 AI 工具查询，请使用 [MCP 服务](/docs/zh/mcp)。

## 基础 URL

| 位置 | 基础 URL |
| --- | --- |
| Flareboard Cloud | `https://api.flareboard.dev` |
| 自托管 | 你自己的 API 地址，例如 `https://api.example.com` |

本页的所有路径都以 `/api` 开头，相对于基础 URL。除 CSV 导出外，请求和响应都是 JSON。示例使用 Cloud 地址。

## 认证

在 bearer 请求头中使用个人 API 密钥进行认证：

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/websites
```

### 创建密钥

1. 登录控制台 [flareboard.dev](https://flareboard.dev)。
2. 打开账户菜单（侧边栏底部你的名字），然后选择 **API 密钥**。
3. 点击 **创建 API 密钥**，输入 **名称** 并选择 **权限范围**。
4. 复制以 `fb_sk_` 开头的密钥，然后点击 **完成**。它只显示一次。

点击密钥旁的 **撤销** 可立即让它失效。每个账号最多可以有 50 个密钥。你注销账号后，该账号的密钥会失效。

### 权限范围

请求所需的权限范围取决于它的 HTTP 方法：

| 权限范围 | 允许的请求 |
| --- | --- |
| **读取** | `GET` 和 `HEAD` |
| **写入** | 其他所有方法：`POST`、`PATCH`、`PUT` 和 `DELETE` |

**写入** 不包含 **读取**。需要两者兼有的密钥必须同时具有两个权限范围。注意，有些只读操作是 `POST` 请求，例如运行 SQL 和评估功能开关，所以它们需要 **写入**。

密钥以你的身份行事，拥有你自己的访问权限，只能看到你能看到的网站。如果你的账号只有查看权限，无论密钥的权限范围如何，每个非 `GET` 请求都会被 `Read-only access` 拒绝。

密钥不能管理凭据或账号。对 `/api/me/api-keys`、`/api/me/password`、`/api/me/delete`、`/api/me/2fa`、`/api/me/sessions` 和 `/api/me/identities` 的请求会返回 403。这些操作请在控制台中完成。

### 项目密钥只用于采集

项目密钥（`fb_pk_...`）在采集服务中标识一个网站。它是公开的，可以出现在你的页面源码中。REST API 不接受它。这里请使用个人密钥（`fb_sk_...`），并妥善保密。

### 检查密钥

`GET /api/me` 返回该密钥所代表的账号：

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/me
```

响应包含 `id`、`username`、`role` 和 `displayName`。

## 时间范围

统计接口用 UTC 时间戳（自纪元起的毫秒数）表示时间段：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `startAt` | number | `endAt` 之前 24 小时（会话、用户和导出为 30 天） | 时间段的开始。 |
| `endAt` | number | 现在 | 时间段的结束。 |
| `unit` | `year`、`month`、`day` 或 `hour` | `day` | 时间序列的分桶大小。 |

例如，在 Unix shell 中取最近 7 天：

```bash
START=$(( ($(date +%s) - 7*86400) * 1000 ))
END=$(( $(date +%s) * 1000 ))
```

如果网站设置了统计重置日期，则该日期之前的事件不会出现在任何统计响应中。统计接口还接受 `segmentId`，用于应用已保存的分群。

## 接口

把 `WEBSITE_ID` 替换成网站的 ID。表中列出了每个接口所需的权限范围。

| 方法 | 路径 | 权限范围 | 作用 |
| --- | --- | --- | --- |
| `GET` | `/api/me` | 读取 | 该密钥所代表的账号。 |
| `GET` | `/api/websites` | 读取 | 你可以访问的网站。 |
| `GET` | `/api/websites/WEBSITE_ID` | 读取 | 一个网站。 |
| `GET` | `/api/websites/WEBSITE_ID/tracking-status` | 读取 | 最近是否有数据到达。 |
| `GET` | `/api/websites/WEBSITE_ID/stats` | 读取 | 页面浏览量、访客、访问、跳出和时间，附带变化。 |
| `GET` | `/api/websites/WEBSITE_ID/stats/overview` | 读取 | 一次调用返回统计、页面浏览序列、一个细分和一个时间序列。 |
| `GET` | `/api/websites/WEBSITE_ID/pageviews` | 读取 | 随时间变化的页面浏览量。 |
| `GET` | `/api/websites/WEBSITE_ID/metrics` | 读取 | 热门页面、来源、国家和其他细分。 |
| `GET` | `/api/websites/WEBSITE_ID/events` | 读取 | 自定义事件及其次数。 |
| `GET` | `/api/websites/WEBSITE_ID/events/series` | 读取 | 某个自定义事件随时间的变化。 |
| `GET` | `/api/websites/WEBSITE_ID/events/stats` | 读取 | 自定义事件总数和有事件的会话数。 |
| `GET` | `/api/websites/WEBSITE_ID/sessions` | 读取 | 会话，分页。 |
| `GET` | `/api/websites/WEBSITE_ID/people` | 读取 | 时间段内活跃的用户。 |
| `GET` | `/api/websites/WEBSITE_ID/export` | 读取 | 以 CSV 导出事件或页面浏览。需要 Cloud 或 Business 套餐。 |
| `GET` | `/api/websites/WEBSITE_ID/feature-flags` | 读取 | 功能开关。需要 Cloud 或 Business 套餐。 |
| `PATCH` | `/api/websites/WEBSITE_ID/feature-flags/FLAG_ID` | 写入 | 修改功能开关。需要 Cloud 或 Business 套餐。 |
| `POST` | `/api/websites/WEBSITE_ID/feature-flags/evaluate` | 写入 | 为某个访客评估一个开关。需要 Cloud 或 Business 套餐。 |
| `POST` | `/api/websites/WEBSITE_ID/warehouse/query` | 写入 | 运行一条只读 SQL 查询。需要 Cloud 或 Business 套餐。 |

控制台的其他功能也有对应接口，例如错误、回放、洞察、看板和日志。它们遵循相同的认证、错误和时间范围规则。套餐要求和网站访问权限的规则与控制台一致。

### 列出网站

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.flareboard.dev/api/websites
```

响应：网站数组。

```json
[
  {
    "id": "YOUR_WEBSITE_ID",
    "name": "My site",
    "domain": "example.com",
    "userId": "USER_ID",
    "replayEnabled": false,
    "timezone": "UTC",
    "autocapture": true,
    "persistVisitors": false,
    "respectDnt": false,
    "retentionDays": null,
    "createdAt": "2026-01-15T09:30:00.000Z"
  }
]
```

未设置的字段，例如 `teamId`、`resetAt`，以及回放、热力图和目标的设置，会被省略或为 `null`。当适用套餐上限时，`retentionDays` 为 `null`（在自托管安装上，表示原始数据无限期保留）。`GET /api/websites/WEBSITE_ID` 以相同的结构返回一个网站。如果网站不存在或你无权访问，它返回 404。

### 检查追踪状态

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/tracking-status
```

```json
{ "hasRecentData": true, "lastEventAt": 1790000000000, "pageviews24h": 42 }
```

过去 15 分钟内有任何事件到达时，`hasRecentData` 为 `true`。`lastEventAt` 是毫秒时间戳，网站没有事件时为 `null`。控制台中的 **测试连接** 使用的就是它。

### 获取统计

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/stats?startAt=$START&endAt=$END"
```

```json
{
  "pageviews": { "value": 1240, "change": 12 },
  "visitors": { "value": 530, "change": 8 },
  "visits": { "value": 610, "change": 9 },
  "bounces": { "value": 240, "change": -3 },
  "totaltime": { "value": 91000, "change": 5 }
}
```

`value` 是你所请求时间段的数值。`change` 是相对于前一个等长时间段的百分比变化。

### 获取概览

`/stats/overview` 在一个响应中返回统计、页面浏览序列、一个细分，以及访客和页面浏览的时间序列。它接受相同的时间参数，另外还有：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | string | `path` | 要包含的细分。取值与下面的 `/metrics` 相同。 |
| `sortBy` | `views`、`visitors` 或 `time` | 无 | `path` 和 `url` 细分的排序方式。 |
| `limit` | 1 到 500 | 10 | 细分的行数。 |

```json
{
  "stats": { "pageviews": { "value": 1240, "change": 12 }, "visitors": { "value": 530, "change": 8 } },
  "pageviews": { "pageviews": [{ "x": "2026-10-08", "y": 410 }] },
  "metrics": [{ "x": "/pricing", "y": 220 }],
  "timeseries": {
    "pageviews": [{ "x": "2026-10-08", "y": 410 }],
    "visitors": [{ "x": "2026-10-08", "y": 180 }]
  }
}
```

实际响应中的 `stats` 对象会列出全部五项统计，如上一节所示。

### 随时间变化的页面浏览量

`GET /api/websites/WEBSITE_ID/pageviews?startAt=...&endAt=...&unit=day` 返回：

```json
{ "pageviews": [{ "x": "2026-10-07", "y": 380 }, { "x": "2026-10-08", "y": 410 }] }
```

### 细分

`GET /api/websites/WEBSITE_ID/metrics?type=referrer&limit=5` 返回由 `x`（取值）和 `y`（次数）组成的排名列表：

```json
[{ "x": "google.com", "y": 310 }, { "x": "news.ycombinator.com", "y": 120 }]
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | string | `path` | `path`、`url`、`entry`、`exit`、`referrer`、`channel`、`browser`、`os`、`device`、`country`、`region`、`city`、`language`、`event` 之一。 |
| `limit` | 1 到 500 | 10 | 返回的行数。 |
| `sortBy` | `views`、`visitors` 或 `time` | 无 | `path` 和 `url` 的排序方式。 |

### 自定义事件

`GET /api/websites/WEBSITE_ID/events?startAt=...&endAt=...` 按次数列出自定义事件，最频繁的在前：

```json
[{ "x": "signup_completed", "y": 48 }, { "x": "purchase", "y": 17 }]
```

`GET /api/websites/WEBSITE_ID/events/series?event=signup_completed&unit=day` 以 `[{ "x": "2026-10-08", "y": 9 }]` 的形式返回某个事件随时间的变化。`event` 参数是必填的：缺少它时 API 返回 400。`GET /api/websites/WEBSITE_ID/events/stats` 返回 `{ "events": { "value": 65 }, "visitors": { "value": 51 } }`，即自定义事件的数量，以及发送过自定义事件的会话数。

页面浏览不是自定义事件，所以不在这些列表中。

### 会话

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/sessions?page=1&pageSize=20&country=DE"
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `page` | number | 1 | 页码，从 1 开始。 |
| `pageSize` | number | 20 | 每页的行数，1 到 100。 |
| `country`、`device`、`browser`、`path`、`referrer` | string | 无 | 只返回匹配的会话。 |

```json
{
  "data": [
    {
      "id": "SESSION_ID",
      "browser": "Chrome",
      "os": "macOS",
      "device": "desktop",
      "country": "DE",
      "city": "Berlin",
      "createdAt": 1790000000000,
      "visits": 1,
      "pageviews": 3,
      "events": 2,
      "lastAt": 1790000120000
    }
  ],
  "count": 134,
  "page": 1,
  "pageSize": 20
}
```

`count` 是所有页面中匹配的会话总数。会话按最近活动时间倒序排列。

### 用户

`GET /api/websites/WEBSITE_ID/people?limit=100&q=ada` 返回 `{ "people": [...], "startAt": ..., "endAt": ... }`。每个用户包含 `personId`、`latestEmail`、`latestName`、`firstSeenAt`、`lastSeenAt`、`sessions`、`visits`、`pageviews`、`events`、`country` 和 `city`。`limit` 为 1 到 500，默认 100。`q` 按 ID、邮箱或姓名过滤。

### 功能开关

这些接口需要网站所有者的账号使用 Cloud 或 Business 套餐。

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags
```

每个开关包含 `id`、`key`、`name`、`description`、`enabled`、`conditionGroups`、`variants`、`payload`、`rollout`、`createdAt` 和 `updatedAt`，以及它的曝光汇总 `summary`。

用开关的 `id` 开启或关闭它（需要具有 **写入** 的密钥）：

```bash
curl -X PATCH \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags/FLAG_ID
```

同一个接口还接受 `name`、`description`、`rollout`、`variants`、`conditionGroups`、`payload` 和 `key`。如果开关的 key 已存在，则返回 400。

为某个访客评估一个开关（因为是 `POST`，需要具有 **写入** 的密钥）：

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "new-checkout", "distinctId": "user_123"}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/feature-flags/evaluate
```

请求包含 `distinctId`、`sessionId` 或 `anonymousId` 时，这次评估会被记录为一次曝光。若要评估而不记录曝光，请使用 [MCP 服务](/docs/zh/mcp) 的 `evaluate_feature_flag` 工具。开关的作用见 [功能开关](/docs/zh/feature-flags)。

### 运行 SQL

`POST /api/websites/WEBSITE_ID/warehouse/query` 对网站的数据运行一条只读查询。它需要 Cloud 或 Business 套餐，以及具有 **写入** 的密钥（因为它是 `POST`）。

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT event_name, COUNT(*) AS n FROM website_event WHERE website_id = ?1 AND event_name IS NOT NULL GROUP BY event_name ORDER BY n DESC LIMIT 10"}' \
  https://api.flareboard.dev/api/websites/WEBSITE_ID/warehouse/query
```

```json
{
  "columns": ["event_name", "n"],
  "rows": [{ "event_name": "signup_completed", "n": 48 }],
  "rowCount": 1,
  "cost": { "rowsRead": 5230, "durationMs": 14 }
}
```

响应中还有一个 `analysis` 对象，描述这条查询是如何被检查的。`GET /api/websites/WEBSITE_ID/warehouse/schema` 列出你可以查询的表和列。

查询必须是一条语句，不含分号或注释，最多 8,000 个字符，以 `SELECT` 或 `WITH` 开头，并且必须按 `website_id = ?1` 过滤。不带 `LIMIT` 时返回 100 行，`LIMIT` 超过 1,000 时会被限制为 1,000。查询读取 100,000 行或运行 10 秒后会停止。每个用户在每个网站上每分钟可以运行 20 条查询。超出后 API 返回 429 和 `Rate limit exceeded`。查询失败时返回 400，原因在 `message` 中。

### 导出 CSV

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  -o events.csv \
  "https://api.flareboard.dev/api/websites/WEBSITE_ID/export?type=events&startAt=$START&endAt=$END"
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `events` 或 `pageviews` | `events` | `events` 导出所有事件，包括页面浏览。`pageviews` 只导出页面浏览。 |
| `startAt`、`endAt` | number | 最近 30 天 | 时间段，单位为毫秒。 |

响应是 `text/csv`，列为 `createdAt`、`sessionId`、`visitId`、`urlPath`、`eventName`、`referrer` 和 `country`，最新的在前，最多 10,000 行。如果上限截掉了较早的行，响应会带上 `X-Truncated: true` 响应头（以及 `X-Row-Cap: 10000`），请用更短的时间段导出其余数据。它需要网站所有者的账号使用 Cloud 或 Business 套餐，并会记录在网站的审计日志中。

## 分页

只有少数接口支持分页：

| 接口 | 参数 | 响应 |
| --- | --- | --- |
| 会话 | `page`、`pageSize`（1 到 100） | `data`、`count`、`page`、`pageSize` |
| 网站活动（`/api/websites/WEBSITE_ID/audit`）和账户活动（`/api/me/audit-log`） | `page`、`pageSize`（1 到 100，默认 50） | `items`、`page`、`pageSize`、`total` |

用户、细分和事件名称等列表改用 `limit`，返回该时间段的前几行。

## 错误

错误是带有 `message` 的 JSON，有时还带有 `code`：

```json
{ "message": "This API key does not have the write scope" }
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数或请求体无效。`message` 会说明具体问题。 |
| 401 | 密钥缺失、格式错误或已被撤销。响应体是 `{ "message": "Invalid API key" }` 或空对象。 |
| 403 | 密钥缺少该方法所需的权限范围，账号是只读的（`Read-only access`），该操作不允许使用密钥，或套餐不包含该功能（例如 `Feature flags require a paid plan.`）。 |
| 404 | 网站或对象不存在，或你无权访问。 |
| 429 | 向有速率限制的接口发送的请求过多。 |

## 速率限制

API 代码对以下接口设置了明确的限制：

| 接口 | 限制 |
| --- | --- |
| `POST /mcp` | 每个密钥每分钟 120 个请求 |
| 网站上的 `POST` SQL 查询和 SQL CSV 导出 | 每个用户在每个网站上每分钟 20 次 |

API 代码对其他接口没有按密钥的限制。尽管如此，请适度使用：缓存经常读取的响应，并用 `/stats/overview` 代替多个单独的调用。

## 故障排查

- **每个请求都返回 401。** 请求头必须是 `Authorization: Bearer fb_sk_...`。项目密钥（`fb_pk_...`）不被接受。
- **在只读调用上返回 403 “does not have the write scope”。** 你调用了 `POST` 接口，例如 SQL。请使用同时具有 **写入** 和 **读取** 的密钥。
- **403 “does not have the read scope”。** 密钥只有 **写入**。请创建一个具有 **读取** 的密钥。
- **你自己的网站返回 404。** 检查网站 ID。它是安装代码里 `data-website-id` 中的 UUID。
- **统计为空。** 默认时间段是最近 24 小时。请传入 `startAt` 和 `endAt`。
