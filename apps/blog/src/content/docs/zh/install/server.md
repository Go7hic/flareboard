---
title: 从服务端发送事件
sidebarTitle: 服务端事件
description: 用普通 HTTP 请求从后端向 Flareboard 发送事件、identify 调用、错误和日志，不需要 SDK。
---

当服务端发生了浏览器看不到的事情时，可以用这种方式上报，例如支付成功、订阅续费、任务完成。你只需要向采集地址发送一个 JSON 请求。如果你已经在用 PostHog 的服务端 SDK，[直接用它们即可](/docs/zh/install/posthog)。

## 开始之前

- Flareboard 里已有一个网站。参见[快速开始](/docs/zh/quickstart)。
- 该网站的**项目密钥**。打开**网站**，进入该网站的**设置**，**项目 API 密钥**卡片里就是它。参见[概念](/docs/zh/concepts)。
- 采集地址：Flareboard Cloud 上是 `https://t.flareboard.dev`，自托管用户使用自己的地址。

示例中使用 `YOUR_PROJECT_KEY`。网站 ID 也可以代替它，但服务端应当使用项目密钥：使用项目密钥的请求有高得多的速率限制（见[限制](#限制)），密钥泄露时也可以轮换。

## 1. 发送一个事件

发送一个请求：

- **方法和 URL：** `POST https://t.flareboard.dev/api/send`
- **请求头：** `Content-Type: application/json`
- **认证：** 把项目密钥（或网站 ID）放在 `payload.website` 中。`Authorization` 请求头是可选的；当你的服务端事件会触发工作流时再加上（见 [用 API 密钥签名请求](#用-api-密钥签名请求)）。

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "event",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "hostname": "example.com",
      "url": "/billing",
      "name": "subscription_renewed",
      "id": "user_123",
      "data": { "plan": "pro", "seats": 5 }
    }
  }'
```

响应为 `200`，其中的 ID 可以忽略：

```json
{ "cache": "…", "sessionId": "…", "visitId": "…" }
```

### 事件字段

请求体是 `{ "type": "<kind>", "payload": { … } }`。当 `"type": "event"` 时，`payload` 接受以下字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `website` | string，必填 | 你的项目密钥（`fb_pk_…`）或网站 ID（UUID）。 |
| `name` | string，最多 50 个字符 | 事件名称。省略则记录为页面浏览，而不是自定义事件。 |
| `data` | object，最多 100 个键 | 事件属性。发送 ID 和套餐名称即可，不要发送密码或其他个人数据。 |
| `id` | string，最多 128 个字符 | 用户的 distinct ID。参见[事件如何归属](#事件如何归属)。 |
| `url` | string | 事件所属的路径，例如 `/billing`。超过 500 个字符会被截断。 |
| `hostname` | string，最多 100 个字符 | 站点的主机名，例如 `example.com`。 |
| `referrer`、`title` | string | 页面上下文。超过 500 个字符会被截断。 |
| `tag` | string，最多 50 个字符 | 可选的标签。 |
| `revenue`、`currency` | number、string | 事件的收入。两者都提供才会被记录。 |
| `timestamp` | integer | 事件发生的时间，自 epoch 起的秒数或毫秒数。可用来延迟补发事件。早于 90 天前或晚于 5 分钟后的时间会被替换为接收时间。 |
| `ip`、`userAgent` | string | 参见[事件如何归属](#事件如何归属)。 |

未知字段会被忽略。请发送 `website`，不要使用 `link` 和 `pixel`，它们属于短链接和追踪像素。

## 2. 发送其他类型的数据

同一个端点还接受其他 `type` 值，它们都使用同样的 `payload.website`。

| `type` | 用途 | `payload` 中的主要字段 |
| --- | --- | --- |
| `identify` | 创建或更新一个用户 | `id`、`data`（用户资料属性） |
| `group` | 把用户加入某个群组，例如公司 | `id`、`groupType`、`groupKey`、`data` |
| `error` | 记录一个错误 | `message`、`errorName`、`stack`、`severity`、`handled`、`release`、`environment` |
| `log` | 记录一条结构化日志 | `level`、`message`、`traceId`、`spanId`、`service`、`release`、`environment` |
| `ai` | 记录一次 LLM 调用 | `provider`、`model`、`inputTokens`、`outputTokens`、`costUsd`、`latencyMs`、`status` |

identify 调用如下：

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "identify",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "id": "user_123",
      "data": { "plan": "pro" }
    }
  }'
```

每种类型的完整字段列表见[采集 API 参考](/docs/zh/reference/ingest-api)。更多内容见[错误追踪](/docs/zh/error-tracking)、[日志与链路追踪](/docs/zh/logs-traces)和 [LLM 分析](/docs/zh/llm-analytics)。

## 3. 一次发送多个事件

`POST https://t.flareboard.dev/api/batch` 接受一个 JSON 数组，数组元素与上面相同，都是 `{ "type", "payload" }` 对象。每一项单独校验，所以有的成功、有的失败是正常的。

```bash
curl -X POST https://t.flareboard.dev/api/batch \
  -H 'Content-Type: application/json' \
  -d '[
    { "type": "event", "payload": { "website": "YOUR_PROJECT_KEY", "hostname": "example.com", "url": "/billing", "name": "invoice_paid", "id": "user_123" } },
    { "type": "event", "payload": { "website": "YOUR_PROJECT_KEY", "hostname": "example.com", "url": "/billing", "name": "invoice_paid", "id": "user_456" } }
  ]'
```

响应会说明每一项的处理结果：

```json
{ "size": 2, "processed": 2, "errors": 0, "details": [], "cache": "…" }
```

失败的项会以 `{ "index": 0, "response": { "message": "…" } }` 的形式列在 `details` 中。一个批次最多 50 项、512 KB，每一项最大 64 KB。

## 4. 不使用 SDK 的示例

### Node.js

Node 18 及更高版本内置了 `fetch`：

```ts
const INGEST = 'https://t.flareboard.dev'

export async function trackServerEvent(name: string, userId: string, data: Record<string, unknown> = {}) {
  const res = await fetch(`${INGEST}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'event',
      payload: {
        website: process.env.FLAREBOARD_PROJECT_KEY,
        hostname: 'example.com',
        url: '/server',
        name,
        id: userId,
        data,
      },
    }),
  })
  if (!res.ok) console.warn('Flareboard rejected the event', res.status, await res.text())
}

await trackServerEvent('subscription_renewed', 'user_123', { plan: 'pro' })
```

### Python

这里使用 `requests` 包（`pip install requests`）：

```python
import os
import requests

INGEST = 'https://t.flareboard.dev'

def track_server_event(name, user_id, data=None):
    res = requests.post(
        f'{INGEST}/api/send',
        json={
            'type': 'event',
            'payload': {
                'website': os.environ['FLAREBOARD_PROJECT_KEY'],
                'hostname': 'example.com',
                'url': '/server',
                'name': name,
                'id': user_id,
                'data': data or {},
            },
        },
        timeout=5,
    )
    if not res.ok:
        print('Flareboard rejected the event', res.status_code, res.text)

track_server_event('subscription_renewed', 'user_123', {'plan': 'pro'})
```

尽量不要让这个调用阻塞你的请求链路：从队列或后台任务中发送，并且不要让调用失败影响你自己的代码。

## 用 API 密钥签名请求

任何人都能用网站的公开密钥发送事件，所以会触发 [工作流](/docs/zh/workflows) 的事件按客户端 IP 地址限流：每个网站每小时 10 次触发。你的服务端发出的所有事件都来自同一个 IP 地址。如果服务端事件会启动工作流，请给请求签名，这样就不受这个限制：

1. 创建一个带 **写入** 权限范围的个人 API 密钥：打开账户菜单（侧边栏底部你的名字），然后选择 **API 密钥**。使用一个能访问该网站的账户。
2. 在 `/api/send` 和 `/api/batch` 请求中放进 `Authorization` 请求头：

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "type": "event",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "hostname": "example.com",
      "url": "/billing",
      "name": "subscription_renewed",
      "id": "user_123"
    }
  }'
```

签名的请求不受按 IP 的触发限制，但每个网站的上限仍然有效：每小时 1,000 次工作流运行和 60 次投递。密钥错误、没有 **写入** 权限范围，或所属用户无权访问该网站时，返回 `401`（在 `/api/batch` 中则是该条目失败），这样出错时你能看到，而不是被悄悄忽略。密钥只能放在你的服务端，绝不要放进网页或移动应用。

## 事件如何归属

- **带 `id`。** 事件归属于该 distinct ID 标识的访客。如果同一用户在浏览器端用该 ID 调用过 `flareboard.identify()`，服务端事件与浏览器事件会对应到同一个访客，因此 `user_123` 的服务端事件和浏览器事件会出现在同一条时间线上。请使用与前端传给 `identify()` 相同的 ID。
- **不带 `id`。** Flareboard 根据你请求的 IP 地址和 user agent 的单向哈希来统计访客，而这个请求来自你的服务器。所有这类事件会合并成一个“访客”。服务端事件请务必发送 `id`。
- **`ip` 和 `userAgent`。** 你可以在 `payload` 中传入最终用户的 IP 地址和 user agent，Flareboard 会对它们做哈希，而不是使用你服务器的。IP 地址不会被存储。user agent 用于计算哈希，以及识别浏览器、操作系统和设备。
- **访问。** 没有 visit token 时，同一访客的事件会按 UTC 的自然小时归入同一次访问。你不需要回传响应里的 `cache` 值。
- **用户。** 只有 `identify` 调用才会在**用户画像**下创建或更新用户资料。用户注册或套餐变化时请发送一次。
- **位置。** 国家和城市来自请求本身，所以服务端事件得到的是你服务器的位置。传入 `ip` 不会改变这一点。

## 检查是否生效

1. 发送第 1 步中的 `curl` 请求。
2. 确认响应为 `200`，并包含 `sessionId` 和 `visitId`。
3. 在控制台中打开该网站的**事件**，查找你的事件名称。

## 限制

| 限制 | 值 |
| --- | --- |
| `/api/send` 的请求体 | 64 KB |
| 批量 | 50 项、512 KB、每项 64 KB |
| 使用项目密钥的请求 | 每个密钥每分钟 30,000 次，所有 IP 合计（默认值，自托管用户可通过 `PROJECT_KEY_RATE_LIMIT` 修改） |
| 使用网站 ID 的事件 | 每个 IP 地址和网站每分钟 100 次请求 |
| 每月事件数（Flareboard Cloud） | 取决于套餐。参见[套餐与限额](/docs/zh/plans-limits)。 |

## 故障排查

| 现象 | 原因 | 解决方法 |
| --- | --- | --- |
| `400` `Website not found.` | 网站 ID 或项目密钥错误，或密钥已被轮换。 | 从**设置**中重新复制密钥。 |
| `400` `Invalid JSON` | 请求体不是合法的 JSON。 | 检查请求体和 `Content-Type` 请求头。 |
| `400` `Payload too large` | 请求体超过 64 KB。 | 发送更小的载荷，或使用 `/api/batch`。 |
| `400` 并带有校验信息 | 某个字段过长或类型错误。 | 对照上面的表格检查。 |
| `402` `Monthly event limit exceeded.` | 套餐的每月额度已用完（仅 Cloud）。 | 等到下个月，或更换套餐。 |
| `429` `Rate limit exceeded` | 请求过多。 | 使用项目密钥而不是网站 ID，并批量发送事件。 |
| `200` 且返回 `{"beep":"boop"}` | 请求的 user agent 看起来像爬虫，因此被忽略。 | 使用 HTTP 客户端默认的 user agent。 |
