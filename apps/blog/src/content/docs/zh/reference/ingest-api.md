---
title: 采集 API 参考
sidebarTitle: 采集 API
description: Flareboard 采集地址上的所有公开端点，包括方法、认证、请求、响应和限制。
---

采集地址接收来自浏览器、服务端、PostHog SDK 和 OpenTelemetry exporter 的数据。本页列出所有公开路由。在 Flareboard Cloud 上，地址是 `https://t.flareboard.dev`。自托管用户使用自己的采集地址。路由是一样的。

面向任务的指南见[从服务端发送事件](/docs/zh/install/server)、[使用 PostHog SDK](/docs/zh/install/posthog)和[日志与链路追踪](/docs/zh/logs-traces)。如果要读取或修改账户中的数据，请改用 `https://api.flareboard.dev` 上的 [REST API](/docs/zh/api)。

## 约定

**认证。** 采集路由不需要登录。请求通过以下任一方式指明所属网站：

| 凭据 | 形式 | 接受它的路由 |
| --- | --- | --- |
| 网站 ID | UUID | `/api/send`、`/api/batch`、`/api/record`、`/api/tracker-config`、`/api/feature-flags/evaluate`、`/api/surveys` 系列路由、`/api/websites/:websiteId/active` |
| 项目密钥 | `fb_pk_` 加 24 位字母和数字 | 所有接受网站 ID 的地方；也是兼容 PostHog 的路由和 OpenTelemetry 路由唯一接受的凭据 |

两者都是公开的。参见[概念](/docs/zh/concepts)。未知的项目密钥会被当作未知网站处理。

**请求。** 除非另有说明，请求体都是 JSON。`/api/send` 和 `/api/record` 把请求体当作文本读取，所以任何 `Content-Type` 都可以（追踪脚本使用 `text/plain` 来避免 CORS 预检请求）。

**CORS。** 所有路由都允许任意来源。允许的请求头有 `Content-Type`、`Content-Encoding`、`Authorization`、`x-flareboard-cache` 和 `x-flareboard-key`。

**错误。** `/api` 下的路由用 `{ "message": "…" }` 和 HTTP 状态码返回错误。兼容 PostHog 的路由使用 PostHog 的格式 `{ "type", "code", "detail" }`。OpenTelemetry 路由按请求使用的编码返回 `{ "code", "message" }` 或 protobuf。意外故障返回 `500` 和 `{ "message": "Server error" }`。

**限制。** 限制按每分钟计算，列在各个路由下，也汇总在[限制](#限制)中。在 Flareboard Cloud 上，账户的每月额度用完后也会停止采集，路由返回 `402`。自托管安装没有套餐限制。

## POST /api/send

采集一个事件、identify 调用、group 调用、错误、日志、AI 调用、web vital 或热力图点击。追踪脚本使用的就是这个路由。

**请求体**

```json
{
  "type": "event",
  "payload": { "website": "YOUR_PROJECT_KEY", "url": "/pricing", "name": "signup" },
  "cache": "TOKEN_FROM_A_PREVIOUS_RESPONSE"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string，必填 | `event`、`identify`、`group`、`performance`、`heatmap`、`error`、`log` 或 `ai`。 |
| `payload` | object，必填 | 该类型对应的字段，见下文。 |
| `cache` | string，可选 | 之前某次响应中的 `cache` 值。用来让事件保持在同一次访问中。也可以放在 `x-flareboard-cache` 请求头中。服务端调用方可以省略。 |

**通用 `payload` 字段。** 适用于 `event`、`identify`、`group`、`performance`、`error`、`log` 和 `ai`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `website` | string | 网站 ID 或项目密钥。请发送这个字段。 |
| `link`、`pixel` | UUID | 短链接和追踪像素使用它们来代替 `website`。 |
| `url` | string | 页面路径，超过 500 个字符会被截断。 |
| `hostname` | string，最多 100 | 页面主机名。 |
| `referrer`、`title` | string | 超过 500 个字符会被截断。 |
| `language` | string，最多 35 | 浏览器语言。 |
| `screen` | string，最多 11 | 例如 `1920x1080`。 |
| `name` | string，最多 50 | 事件名称。没有它时，`event` 就是一次页面浏览。 |
| `tag` | string，最多 50 | 可选的标签。 |
| `data` | object，最多 100 个键 | 属性。 |
| `id` | string，最多 128 | 用户的 distinct ID。 |
| `anonymousId` | string，最多 128 | 追踪脚本生成的随机设备 ID。只有网站开启了**跨会话识别访客**时才会作为访客计数，否则会被丢弃。 |
| `timestamp` | integer | 自 epoch 起的秒数或毫秒数。如果早于 90 天前或晚于 5 分钟后，则使用接收时间。 |
| `revenue`、`currency` | number、string（最多 10） | 收入。两者都提供才会被记录。 |
| `ip`、`userAgent`、`browser`、`os`、`device` | string | 覆盖从请求中读取到的值。IP 地址只用于哈希，不会被存储。 |

**按 `type` 区分的字段**

| `type` | 字段 |
| --- | --- |
| `event` | 通用字段。匹配到的行为定义会标记在事件上。`name: "$alias"` 加上 `data: { "alias", "distinctId" }` 会把匿名 ID 关联到用户 ID。 |
| `identify` | `id`、`data`。创建或更新用户。 |
| `group` | `id`、`groupType`（最多 80）、`groupKey`（最多 200）、`data`。 |
| `performance` | `lcp`、`inp`、`cls`、`fcp`、`ttfb`，放在顶层或 `data` 中均可。 |
| `heatmap` | `kind`（`click` 或 `scroll`）、`url`、`hostname`；点击还需要 `x`、`y`、`viewportWidth`、`viewportHeight`，滚动还需要 `scrollDepth`（0 到 100）。`website` 必须是网站 ID 或项目密钥。 |
| `error` | `message`（最多 1,000）、`errorName`、`stack`（最多 12,000）、`source`、`lineno`、`colno`、`severity`（`fatal`、`error`、`warning`、`info`）、`handled`、`release`、`environment`、`data`。 |
| `log` | `level`（`trace`、`debug`、`info`、`warn`、`error`、`fatal`）、`message`、`traceId`、`spanId`、`parentSpanId`、`service`、`operation`、`durationMs`、`status`、`release`、`environment`、`data`。 |
| `ai` | `kind`（`generation`、`span`、`trace`、`embedding`）、`provider`、`model`、`name`、`inputTokens`、`outputTokens`、`totalTokens`、`cacheReadTokens`、`cacheWriteTokens`、`costUsd`、`latencyMs`、`status`（`success` 或 `error`）、`message`、`quality`、`traceId`、`spanId`、`parentSpanId`、`operation`、`input`、`output`（任意 JSON，各 32 KB；网站不保存内容时会被丢弃）、`release`、`environment`、`data`。 |

**响应。** `200`：

```json
{ "cache": "…", "sessionId": "…", "visitId": "…" }
```

热力图点击，以及短链接或追踪像素的点击，返回 `{ "ok": true }`。来自爬虫 user agent 的请求返回 `200` 和 `{ "beep": "boop" }`，并被丢弃。`node`、`axios`、`python-requests`、`curl` 和 `Go-http-client` 等 HTTP 客户端的 user agent 会被接受。

| 状态 | 响应体 | 含义 |
| --- | --- | --- |
| `400` | `{ "message": "Payload too large" }` | 请求体超过 64 KB（65,536 个字符）。 |
| `400` | `{ "message": "Invalid JSON" }` | 请求体不是 JSON。 |
| `400` | `{ "message": "Website not found." }` | 网站 ID 或项目密钥未知。 |
| `400` | `{ "message": "…" }` | 某个字段未通过校验。 |
| `402` | `{ "message": "Monthly event limit exceeded." }` | Cloud 额度已用完。 |
| `429` | `{ "message": "Rate limit exceeded" }` | 超过速率限制。 |

**限制。** 每个请求 64 KB。使用网站 ID 时：每个 IP 地址和网站每分钟 100 个请求。使用项目密钥时：每个密钥每分钟 30,000 个。

## POST /api/batch

在一个请求里发送多个 `/api/send` 的请求体。

**请求体。** 一个 JSON 数组，最多 50 个 `{ "type", "payload" }` 形式的对象，总共最大 512 KB，每项最大 64 KB。每一项单独校验和处理，检查与 `/api/send` 相同。

**响应。** `200`：

```json
{ "size": 2, "processed": 1, "errors": 1, "details": [{ "index": 1, "response": { "message": "Website not found." } }], "cache": "…" }
```

`cache` 是第一个返回了该值的项的令牌。针对整个请求的错误是 `400`（`Batch payload too large`、`Invalid JSON`、`Expected array`、`Batch exceeds 50 items`）和 `429`。

**限制。** 除非每一项都通过项目密钥指明网站，否则批量调用本身每个 IP 地址每分钟限 100 次，并且每一项也会计入 `/api/send` 的按网站限制。如果批次中每一项都使用项目密钥，则只计入该密钥的限制。

## POST /api/record

接收会话回放的一个分块。`recorder.js` 会调用它，你不需要自己调用。参见[会话回放](/docs/zh/session-replay)。

**请求体**

```json
{
  "type": "record",
  "payload": {
    "website": "YOUR_WEBSITE_ID",
    "sessionId": "…",
    "visitId": "…",
    "chunkIndex": 0,
    "events": [],
    "startedAt": 1760000000000,
    "endedAt": 1760000005000
  }
}
```

**响应。** 已存储时返回 `200` 和 `{ "ok": true, "replayId": "…", "r2Key": "…" }`；该分块已存在时返回 `{ "ok": true, "replayId": "…", "deduped": true }`；没有存储任何内容时返回 `{ "ok": true, "skipped": true }`（来自爬虫、网站关闭了回放、套餐不含回放，或每月回放额度已用完）。错误：`400`（`Payload too large`、`Invalid JSON`、`Website not found`、校验失败）和 `429`。

**限制。** 每个请求 512 KB。速率限制与 `/api/send` 相同。除非网站开启了控制台和网络记录，否则这些条目会被丢弃，并且每个条目都会按允许的字段列表重新构建。

## GET /api/tracker-config

返回追踪脚本为某个网站所需的设置。

**查询参数。** `website`（或 `key`，脚本在使用 `data-project-key` 时发送它）：网站 ID 或项目密钥。必填（缺少时返回 `400`，未知时返回 `404`）。

**响应。** `200`，JSON，缓存 60 秒（`Cache-Control: public, max-age=60`）：

| 字段 | 说明 |
| --- | --- |
| `websiteId` | 网站 ID。 |
| `autocapture`、`persistence`、`respectDnt` | 网站的**数据采集**设置。`persistence` 对应**跨会话识别访客**。 |
| `replay` | 会话回放设置：`sampleRate`、`maskInputs`、`maskAllText`、`maskSelector`、`blockSelector`、`console`、`network`、`minDurationMs`。 |
| `heatmapSampleRate`、`heatmapEnabled` | 热力图采样。 |
| `featureFlags` | 已启用的开关，包含 `key`、`enabled`、`rollout`、`variants`、`targeted`，设置了时还有 `payload`。定向规则从不会被暴露。`targeted: true` 的开关通过 `/api/feature-flags/evaluate` 求值。 |
| `earlyAccessFeatures` | `flagKey`、`name`、`description`。 |
| `surveys` | 进行中的问卷。 |

## POST /api/feature-flags/evaluate

对需要服务端定向的开关求值。

**请求体**

```json
{
  "website": "YOUR_PROJECT_KEY",
  "keys": ["pricing.banner"],
  "context": { "path": "/pricing", "language": "en-US", "distinctId": "user_123", "sessionId": "session-abc" }
}
```

`website` 和 `keys` 必填。最多使用 200 个不重复的 key。`context` 可以包含 `distinctId`、`userId`、`sessionId`、`visitId`、`anonymousId`、`path`、`url`、`hostname`、`referrer`、`language`、`userAgent`、`environment`、`release`、`groups`、`properties`、`personProperties` 和 `groupProperties`。

**响应。** `200`：

```json
{ "results": { "pricing.banner": "test" }, "payloads": {} }
```

每个结果是一个变体 key；没有变体的已启用开关返回 `'test'`；开关对此上下文关闭时返回 `'control'`；该 key 不是网站的已启用开关时返回 `false`。`payloads` 包含带有 payload 的已启用开关的 payload。错误：`400`（`website is required`、`keys is required`）、`404` 和 `429`。

**限制。** 使用网站 ID 时：每个 IP 地址每分钟 120 个请求。使用项目密钥时：该密钥的开关额度（每分钟 30,000）。

## 问卷

### GET /api/surveys

返回某个网站进行中的问卷，格式与 `/api/tracker-config` 中的 `surveys` 相同。

**查询参数。** `website`：网站 ID 或项目密钥。必填。

**响应。** `200`，返回 `{ "surveys": [ … ] }`，缓存 60 秒。只列出已启用、处于排期内且未达到回复上限的问卷。缺少 `website` 时返回 `400`，未知时返回 `404`。

### POST /api/surveys/response

保存一条问卷回答，来源可以是追踪脚本、托管的问卷页面或你自己的客户端。

**请求体**

```json
{
  "website": "YOUR_WEBSITE_ID",
  "surveyId": "SURVEY_ID",
  "answers": { "nps": 10, "why": "Faster exports" },
  "completed": true,
  "responseId": "OPTIONAL_UUID",
  "source": "api"
}
```

| 字段 | 说明 |
| --- | --- |
| `website`、`surveyId` | 必填。 |
| `answers` | 问题 ID 到值的映射。未知的 ID 和无效的值会被丢弃。至少需要一个有效回答。旧的 `answer` 形式（一个字符串，对应第一个问题）仍然可用。 |
| `completed` | `false` 表示记录部分回答。 |
| `responseId` | 你自己生成的 UUID。用相同的 ID 再次提交会合并回答。 |
| `source` | `widget`、`hosted` 或 `api`。 |
| `distinctId`、`sessionId`、`visitId`、`urlPath` | 可选的归因信息。 |

**响应。** `200`，返回 `{ "ok": true, "responseId": "…", "completed": true }`。校验失败、网站或问卷未知、没有有效回答时返回 `400`。问卷已关闭或该回复已完成时返回 `409`。请求体超过 32 KB 时返回 `413`。超出限制时返回 `429`。

**限制。** 每个 IP 地址每分钟 30 个请求，并且每个 IP 地址对每份问卷每小时 5 个。

### GET /api/surveys/hosted/:key

返回托管问卷的公开定义。`:key` 是问卷 ID 或它的 slug。

**响应。** `200`，返回 `{ id, websiteId, name, closed, questions, appearance }`。`closed: true`（且没有 questions）表示问卷已停用、不在排期内或已达到回复上限。问卷不存在或没有托管页面时返回 `404`。不缓存。每个 IP 地址限每分钟 60 个请求。

## 兼容 PostHog 的路由

这些路由让 PostHog SDK 可以向 Flareboard 发送数据。它们只通过项目密钥认证。参见[使用 PostHog SDK](/docs/zh/install/posthog)。

### POST /capture, /e, /i/v0/e, /batch, /track

这五个路径作用相同，带不带结尾的斜杠都可以。它们接受单个事件、事件数组，或 `{ "api_key", "batch", "sent_at" }`。

**认证。** 项目密钥取自 `api_key`、`token`，或某个事件的 `properties.token`。带有其他项目密钥的事件会被丢弃。

**请求体编码。** JSON；gzip（`?compression=gzip-js`、`Content-Encoding: gzip`，或裸的 gzip 请求体）；`data=<base64>` 表单请求体；或带 `?compression=base64` 的 base64 请求体。旧的 `lz64` 编码会被以 `400` 拒绝。

**每个事件**需要 `event`（超过 200 个字符会被截断）和 `distinct_id`（最多 200 个字符）。如果存在，会使用 `timestamp`、`offset`、`uuid`、`$set`、`$set_once` 和 `properties`。

**响应。** `200`，返回 `{ "status": 1 }`。

| 状态 | `code` | 含义 |
| --- | --- | --- |
| `400` | `invalid_payload` | 请求体无法解码，或没有有效事件。 |
| `401` | `invalid_api_key` | 项目密钥缺失或未知。 |
| `402` | `quota_limited` | Cloud 额度已用完。 |
| `413` | `invalid_payload` | 请求过大。 |
| `429` | `rate_limited` | 超过速率限制。 |

**限制。** 传输时 2 MB，解码后 8 MB，每个请求 1,000 个事件，每个项目密钥每分钟 30,000 个请求。

### POST /decide, /flags

对网站的所有已启用功能开关求值，并返回 SDK 配置。两个路径接受相同的请求并返回相同的响应，带不带结尾的斜杠都可以。

**请求体。** JSON（适用上面的编码）。项目密钥取自请求体中的 `token` 或 `api_key`，或 `?token=`。还会用到的字段有：`distinct_id`、`$anon_distinct_id` 或 `$device_id`、`person_properties`、`groups`、`flag_keys` 或 `flag_keys_to_evaluate`（只对部分开关求值），以及 `disable_flags`。

**响应。** `200`，包含 `featureFlags`（key 对应 `true`、`false` 或变体 key）、`featureFlagPayloads`、`flags`（每个开关的详情对象，含原因）、`requestId`，以及配置字段（`sessionRecording: false`、`surveys: false`、`heatmaps: false` 等等）。密钥缺失或未知时返回 `401`，超出开关额度（每个密钥每分钟 30,000 个请求）时返回 `429`。

### GET /array/:token/config, /array/:token/config.js

posthog-js 启动时加载的远程配置。`:token` 是项目密钥。`config.js` 以脚本形式返回同样的配置。缓存 60 秒。密钥未知时返回 `404`，超出开关额度时返回 `429`。

## OpenTelemetry (OTLP/HTTP)

### POST /v1/logs, POST /v1/traces

接收 OpenTelemetry 的日志和链路。把 OpenTelemetry SDK 或 Collector 指向采集地址即可。不接受指标（metrics），也不支持 gRPC。参见[日志与链路追踪](/docs/zh/logs-traces)。

**认证。** 项目密钥，通过 `Authorization: Bearer YOUR_PROJECT_KEY` 或 `x-flareboard-key: YOUR_PROJECT_KEY` 传入。不接受网站 ID。

**请求。** `Content-Type: application/json` 或 `application/x-protobuf`（`application/protobuf` 也可以）。`Content-Encoding` 可以是 `gzip` 或不设置。

**响应。** `200`，以请求使用的编码返回 OTLP 导出响应；当部分记录被拒绝时，带有 `partialSuccess`（`rejectedLogRecords` 或 `rejectedSpans`，以及 `errorMessage`）。超过 30 天的记录会被拒绝。

| 状态 | 含义 |
| --- | --- |
| `400` | JSON 或 protobuf 格式错误。 |
| `401` | 项目密钥缺失或未知。 |
| `402` | 每月日志和 span 额度已用完（Cloud）。 |
| `413` | 请求体过大，或记录超过 10,000 条。 |
| `415` | 不支持的 `Content-Type` 或 `Content-Encoding`。 |
| `429` | 被限流。`Retry-After: 30`。请重试。 |
| `501` | 此部署不提供 OTLP。 |
| `503` | 存储暂时不可用。`Retry-After: 5`。请重试。 |

**限制。** 传输时 4 MB，解码后 8 MB，每个请求 10,000 条记录，每个项目密钥每分钟 30,000 个请求（与事件采集的额度分开计算）。

## 脚本

### GET /script.js

浏览器追踪脚本。`Content-Type: application/javascript`，`Cache-Control: public, max-age=86400`。用 `<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>` 安装。所有选项见[追踪脚本参考](/docs/zh/reference/tracker)。

### GET /recorder.js

会话回放录制器。响应头与 `script.js` 相同。它需要 rrweb 的 UMD 构建，并且要先加载 `script.js`。参见[会话回放](/docs/zh/session-replay)。

## 其他路由

| 路由 | 说明 |
| --- | --- |
| `GET /` | 返回 `{ "name": "flareboard-ingest", "version": "0.0.1" }`。 |
| `GET /api/heartbeat` | 返回 `{ "ok": true }`。 |
| `GET /api/websites/:websiteId/active` | 返回 `{ "users": 12 }`，即最近 5 分钟内出现的访客数。`:websiteId` 可以是项目密钥。未知的网站返回 `{ "users": 0 }`。 |
| `GET /:slug`、`GET /l/:slug`、`GET /api/links/:slug/redirect` | 短链接。返回 `302` 跳转到链接的目标并记录点击。slug 未知时返回 `404`。 |
| `GET /p/:slug.gif` | 追踪像素。始终返回 1x1 的透明 GIF，像素存在时记录这次访问。 |

## 限制

| 路由 | 限制 |
| --- | --- |
| `/api/send` | 每个请求 64 KB。每个 IP 和网站每分钟 100 次（网站 ID），或每个密钥每分钟 30,000 次（项目密钥）。 |
| `/api/batch` | 50 项、512 KB、每项 64 KB。 |
| `/api/record` | 每个请求 512 KB。速率限制与 `/api/send` 相同。 |
| `/api/feature-flags/evaluate` | 每个 IP 每分钟 120 次（网站 ID），或该密钥的开关额度每分钟 30,000 次（项目密钥）。 |
| `/api/surveys/response` | 32 KB。每个 IP 每分钟 30 次，每个 IP 对每份问卷每小时 5 次。 |
| `/api/surveys/hosted/:key` | 每个 IP 每分钟 60 次。 |
| `/capture`、`/e`、`/i/v0/e`、`/batch`、`/track` | 传输时 2 MB，解码后 8 MB，1,000 个事件。每个密钥每分钟 30,000 次。 |
| `/decide`、`/flags`、`/array/:token/config` | 每个密钥每分钟 30,000 次，与采集额度分开计算。 |
| `/v1/logs`、`/v1/traces` | 传输时 4 MB，解码后 8 MB，10,000 条记录。每个密钥每分钟 30,000 次，单独计算。 |

每个密钥的限制默认是每分钟 30,000 个请求。自托管用户可以通过采集 Worker 的 `PROJECT_KEY_RATE_LIMIT` 变量修改。Flareboard Cloud 的每月额度见[套餐与限额](/docs/zh/plans-limits)。
