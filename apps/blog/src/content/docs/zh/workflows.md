---
title: 工作流
description: 在事件发生时运行自动化。可以筛选、等待、按条件分支，然后调用 webhook、发送邮件或发到 Slack，并支持测试、运行记录和重试。
---

工作流在某个指定名称的事件到达时启动，例如 `checkout_completed` 或 `signup`。随后它按顺序执行一组步骤：等待、检查条件、调用 webhook、发送邮件，或发到 Slack。你可以在工作流上线前用一个示例事件对它进行测试，每次运行也都会被记录。

## 开始之前

- 一个已经在发送你想响应的那个事件的网站。见 [追踪事件](/docs/zh/events)。
- 网站的编辑权限。只读权限下，你可以查看工作流和运行记录，但不能创建、测试或修改它们。请求头的值和 Slack URL 对只读用户是隐藏的。
- 仅自托管：邮件步骤需要你的部署配置好邮件发送。见 [配置](/docs/zh/self-host/configuration)。

来自追踪脚本、服务端 API 和 PostHog SDK 的事件都可以启动工作流。普通的页面浏览没有名称，所以不行。工作流不要求特定套餐。

## 1. 创建工作流

1. 打开网站，再打开 **工作流**（在 **自动化** 下）。
2. 点击 **创建工作流**。
3. 输入 **名称**，并选择 **触发事件**（事件名，例如 `checkout_completed`）。选择器会列出该网站已收到的事件。可选的 **描述** 用来说明这个工作流的用途。
4. 如果希望它只对部分事件运行，添加 **触发筛选**（见下文）。
5. 添加 **步骤**。
6. 点击 **创建工作流**。

如果工作流有 webhook 步骤，Flareboard 会在你创建之后，在工作流的 **概览** 上只显示一次 **Webhook 签名密钥**。请在那时复制。见 [验证 webhook](#验证-webhook)。

用工作流上的 **启用** 和 **停用** 来开关它。已停用工作流中未完成的运行，会在执行下一步之前被取消。没有步骤的工作流只记录它的运行。

### 触发筛选

筛选条件用来缩小启动工作流的事件范围。所有筛选条件都必须匹配。一个工作流最多可以有 20 个。

| 字段 | 匹配 |
| --- | --- |
| **事件属性** | 事件的某个属性。把属性名作为键填入 |
| **用户属性** | 发送该事件的用户的某个属性。把属性名作为键填入 |
| **路径** | 事件的页面路径 |
| **URL** | 完整的页面 URL |
| **主机名** | 页面的主机名 |

运算符：**等于**、**不等于**、**包含**、**不包含**、**开头是**、**结尾是**、**大于**、**大于等于**、**小于**、**小于等于**、**已设置** 和 **未设置**。文本比较不区分大小写，数值运算符需要一个数字。

### 步骤

步骤按顺序运行。一个工作流最多可以有 20 个步骤，其中最多 10 个可以是 webhook、邮件或 Slack 步骤。

**延迟。** 等待 1 分钟到 7 天。同一个工作流中所有延迟加起来最多 30 天。

**条件。** 只有当步骤运行时每个条件都成立，才会继续。用户属性会在那一刻重新读取，所以延迟之后的条件看到的是最新数据。如果条件不成立，运行会在这里以状态 **已停止** 结束。

**Webhook。** 发送一个 HTTP 请求。

| 设置 | 作用 |
| --- | --- |
| **请求方法** | `POST`（默认）、`PUT`、`PATCH`、`GET` 或 `DELETE`。`GET` 和 `DELETE` 不发送请求体 |
| **URL** | 公网的 `http` 或 `https` 地址。私有地址、回环地址和内部主机、IPv6 字面量以及带凭据的 URL 会被拒绝 |
| **请求头** | 最多 20 个。`Host`、`Content-Length`、`User-Agent`、`Cookie` 等名称，以及任何以 `X-Flareboard-` 或 `CF-` 开头的名称，由 Flareboard 设置，会被拒绝 |
| **JSON 请求体** | 最多 10,000 个字符的模板。留空则发送下面的默认负载 |

**邮件。** 向最多 5 个 **收件人** 发送一封纯文本邮件，带有 **主题** 和 **消息**。留空则使用默认值：主题为 `Flareboard workflow: {{workflow.name}}`，正文是一段包含事件名、页面和时间的简短消息。Flareboard 会加上页脚，说明是哪个工作流发送的。

**Slack。** 向 Slack 的 incoming webhook 发送一条 **消息**（最多 3,000 个字符）。URL 必须以 `https://hooks.slack.com/` 或 `https://hooks.slack-gov.com/` 开头。插入的值会被转义，所以属性里不能添加提及或链接。

### 占位符

在 webhook 的请求头值和 JSON 请求体、邮件的主题和消息，以及 Slack 消息中，可以使用 `{{name}}` 占位符。webhook 和 Slack 的 URL 不支持模板。点击编辑器中的占位符，会把它插入到你最后编辑的字段里。

| 占位符 | 值 |
| --- | --- |
| `{{event.name}}`、`{{event.id}}`、`{{event.timestamp}}` | 事件名、事件 ID 和事件时间（ISO 8601） |
| `{{event.url}}`、`{{event.path}}`、`{{event.hostname}}` | 页面 |
| `{{event.distinct_id}}`、`{{event.session_id}}` | 用户 ID 和会话 |
| `{{event.properties.KEY}}` | 一个事件属性。把 `KEY` 换成它的名称。支持嵌套的值，例如 `{{event.properties.plan.tier}}` |
| `{{person.distinct_id}}`、`{{person.properties.KEY}}` | 用户及其某个属性 |
| `{{website.id}}`、`{{website.name}}`、`{{website.domain}}` | 网站 |
| `{{workflow.id}}`、`{{workflow.name}}`、`{{execution.id}}` | 工作流和本次运行 |

在 JSON 请求体中，位于引号内字符串里的占位符会作为转义后的文本插入。引号外的占位符会作为 JSON 值插入，所以 `"amount": {{event.properties.amount}}` 发送的是数字。缺失的值会变成 `null`。保存时，Flareboard 会检查请求体是有效的 JSON，并且每个占位符都是已知的。

只有 32 KB 以内的事件属性才会带入一次运行。

### 默认 webhook 负载

请求体为空时，webhook 发送：

```json
{
  "type": "workflow",
  "workflowId": "…",
  "workflowName": "Notify sales",
  "executionId": "…",
  "websiteId": "…",
  "sessionId": "…",
  "visitId": "…",
  "eventId": "…",
  "eventName": "checkout_completed",
  "createdAt": 1760000000000,
  "event": {
    "name": "checkout_completed",
    "timestamp": "2026-10-09T10:13:20.000Z",
    "url": "https://example.com/checkout",
    "path": "/checkout",
    "hostname": "example.com",
    "distinctId": "user_123",
    "properties": { "plan": "pro" }
  },
  "person": { "distinctId": "user_123", "properties": {} },
  "website": { "id": "…", "name": "My site", "domain": "example.com" }
}
```

事件没有用户 ID 时，`person` 为 `null`。

### 请求头

每个 webhook 请求都带有这些请求头：

| 请求头 | 值 |
| --- | --- |
| `User-Agent` | `Flareboard-Webhooks/1.0 (+https://flareboard.dev)` |
| `Content-Type` | `application/json`，在有请求体且你没有设置 content type 时 |
| `X-Flareboard-Event` | 事件名 |
| `X-Flareboard-Delivery` | 该步骤这次投递的 ID，每次尝试都相同。可用它去重 |
| `X-Flareboard-Execution` | 运行 ID |
| `X-Flareboard-Attempt` | 尝试次数，从 1 开始 |
| `X-Flareboard-Timestamp` | 以秒为单位的 Unix 时间 |
| `X-Flareboard-Signature` | `v1=` 后接 HMAC，见下文 |
| `X-Flareboard-Test` | `1`，仅在测试发送时带有 |

### 验证 webhook

签名是 `v1=` 加上 `HMAC-SHA256(secret, "<X-Flareboard-Timestamp>.<raw body>")` 的十六进制，使用工作流的签名密钥（以 `whsec_` 开头）。请对原始请求体重新计算，并拒绝过旧的时间戳：

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyFlareboard(rawBody, headers, secret) {
  const timestamp = headers['x-flareboard-timestamp'];
  const received = headers['x-flareboard-signature'] ?? '';
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

要获取新的密钥，打开工作流，进入 **概览**，点击 **轮换密钥**。旧密钥会立即失效，包括仍在等待的投递的重试，所以请马上更新你的接收端。只有工作流含有 webhook 步骤时，才会出现签名密钥这一部分。

## 2. 测试工作流

打开工作流，再打开 **测试** 标签（需要编辑权限）。

1. 点击 **载入最近事件**，用触发事件名对应的最近一条已存储事件填充表单，或自己填写：**页面 URL 或路径**、**Distinct ID**（可选，会载入该用户已存储的属性）、**事件属性（JSON）** 和 **用户属性覆盖（JSON）**。
2. 点击 **预览**，渲染每个步骤但不发送任何内容；或点击 **发送测试**，把每个 webhook、邮件和 Slack 步骤各投递一次。

结果会说明示例事件是否匹配触发筛选（如果不匹配，就不会运行任何步骤），并把每个步骤显示为 **已生成**、**已发送**、**已通过**、**在此停止**、**失败**、**已跳过** 或 **未执行到**。已发送的步骤会显示响应码和响应体。延迟会被跳过，测试运行不会被记录。Webhook 测试带有请求头 `X-Flareboard-Test: 1`。一个网站每小时最多可以发送 30 次测试。

## 3. 查看运行记录

打开工作流，在 **概览** 中查看流程、每日运行次数图表、成功率和状态分布。打开 **运行记录**，可以看到触发条件每次触发的情况，最新的在前。

- 可以按状态、按日期（**开始日期** 和 **结束日期**）筛选，也可以按事件、会话或错误搜索。
- 展开一次运行（**查看步骤详情**），可以看到每个步骤、每次尝试、响应码和响应体、下一次尝试的时间，以及处于等待的运行何时继续。

运行状态：

| 状态 | 含义 |
| --- | --- |
| **已记录** | 工作流没有步骤，所以这次运行只被记录 |
| **排队中**、**运行中** | 即将运行，或正在运行 |
| **等待中** | 处于延迟步骤 |
| **重试中** | 一次投递失败，将会再次尝试 |
| **成功** | 所有步骤都已完成 |
| **失败** | 某个步骤彻底失败，或用完了尝试次数 |
| **已停止** | 某个条件步骤不成立 |
| **已限流** | 因为网站在一小时内超过 60 次投递，某次投递被拒绝，运行随之结束 |
| **已取消** | 运行完成之前，工作流被停用或删除 |

运行及其尝试日志保留 90 天。删除工作流会删除它的日志，并停止待执行的运行。

## 限制与重试

| 限制 | 值 |
| --- | --- |
| 每个网站启动的运行数 | 每小时 1,000 次。超出的触发会被丢弃 |
| 每个网站的投递数（webhook、邮件和 Slack 步骤的首次尝试） | 每小时 60 次。重试不计入 |
| 来自同一个客户端 IP 的触发 | 总共每分钟 30 次，对同一个网站每小时 10 次。从你的服务端发送的事件计入服务端 IP，除非你 [用 API 密钥签名](/docs/zh/install/server#用-api-密钥签名请求) |
| Webhook 和 Slack 请求时间 | 10 秒。更慢的请求算作一次失败的尝试 |
| 每次投递的尝试次数 | 5 次，间隔依次为 30 秒、2 分钟、8 分钟和 32 分钟 |
| 步骤 | 20 个，其中最多 10 个是 webhook、邮件或 Slack |
| 延迟 | 每个步骤 1 分钟到 7 天，每个工作流 30 天 |

遇到网络错误、超时，或响应为 `408`、`425`、`429` 或任何 `5xx` 时，投递会被重试。其他 `4xx` 响应是永久性失败，例如 URL 错误或凭据被拒绝。

## 检查是否生效

1. 创建一个带有 Slack、webhook 或邮件步骤的工作流。
2. 打开 **测试**，点击 **载入最近事件**，再点击 **发送测试**。确认结果是 **已发送**，并且你的目标端已经收到。
3. 启用工作流，触发真实事件，然后打开 **运行记录**。这次运行显示 **成功**。

## 故障排查

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| 没有出现任何运行 | 事件名不一致、某个筛选不匹配，或工作流已停用 | 把触发条件与 **事件** 中的名称对照。用 **测试** 查看示例事件是否匹配 |
| **已限流** | 网站在一小时内超过 60 次投递 | 减少触发，或添加条件步骤来缩小范围 |
| 失败，状态为 `4xx` | 目标端拒绝了请求 | 在运行的步骤详情中检查 URL、请求头和请求体 |
| **Rendered body is not valid JSON** | 占位符或模板破坏了 JSON | 用 **预览** 测试并修正请求体 |
| 邮件步骤失败，并提示邮件发送相关的消息 | 此部署没有配置邮件发送 | 自托管：配置邮件发送。见 [配置](/docs/zh/self-host/configuration) |
| 签名校验失败 | 你对解析后的请求体做了哈希，或密钥已被轮换 | 对原始请求体做哈希，并使用当前的密钥 |
