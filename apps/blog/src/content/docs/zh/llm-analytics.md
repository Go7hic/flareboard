---
title: LLM 分析
description: 用 PostHog 的 LLM 封装或 flareboard.ai() 记录 LLM 调用，然后在 AI 可观测页面按模型、调用链和用户查看成本、token、延迟和错误。
---

Flareboard 把每次 LLM 调用记录为一个 AI 事件，并据此生成成本、token、延迟和错误的图表，带有每个步骤的调用链列表，以及每个用户的成本。发送数据有两种方式，最终都进入同一个地方：

- **PostHog LLM 封装**（posthog-python、posthog-node、LangChain 回调），指向 Flareboard。
- **Flareboard 自己的调用**：浏览器脚本或 npm 包中的 `flareboard.ai()`，或从你的服务端向 `/api/send` 发送 `POST`。

## 开始之前

- Flareboard 中的一个网站。见 [快速开始](/docs/zh/quickstart)。
- 它的 **项目密钥**（`fb_pk_…`）。打开 **网站**，进入网站的 **设置**，**项目 API 密钥** 卡片会显示它。见 [核心概念](/docs/zh/concepts#项目密钥)。
- 采集地址：Flareboard Cloud 上是 `https://t.flareboard.dev`，自托管请使用你自己的地址。

AI 事件按事件存储，所以会计入你的月度事件额度。见 [套餐与限制](/docs/zh/plans-limits)。

## 1. 用 PostHog 封装发送 LLM 调用

把采集地址作为 PostHog 的 host，把项目密钥作为 PostHog 的 API key。通用设置见 [PostHog SDK](/docs/zh/install/posthog)。

### Python（OpenAI）

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI

posthog = Posthog("YOUR_PROJECT_KEY", host="https://t.flareboard.dev")
client = OpenAI(api_key="YOUR_OPENAI_API_KEY", posthog_client=posthog)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is Flareboard?"}],
    posthog_distinct_id="user_123",        # 这次调用归属的用户
    posthog_trace_id="conversation-42",    # 把多次调用归入同一条调用链
    posthog_properties={"feature": "chat"},
)
posthog.shutdown()
```

Anthropic 和 Gemini 的封装，以及 LangChain 的 `CallbackHandler`，用法相同。LangChain 的 handler 会发送完整的调用链、span 和生成树。

### Node.js（OpenAI）

```js
import { PostHog } from 'posthog-node'
import { OpenAI } from '@posthog/ai'

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, posthog })

await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is Flareboard?' }],
  posthogDistinctId: 'user_123',
  posthogTraceId: 'conversation-42',
})
await posthog.shutdown()
```

### Capture API（curl）

```bash
curl -X POST https://t.flareboard.dev/batch/ \
  -H 'Content-Type: application/json' \
  -d '{
    "api_key": "YOUR_PROJECT_KEY",
    "batch": [{
      "event": "$ai_generation",
      "distinct_id": "user_123",
      "properties": {
        "$ai_trace_id": "conversation-42",
        "$ai_model": "gpt-4o-mini",
        "$ai_provider": "openai",
        "$ai_input": [{"role": "user", "content": "What is Flareboard?"}],
        "$ai_output_choices": [{"role": "assistant", "content": "An analytics platform."}],
        "$ai_input_tokens": 12,
        "$ai_output_tokens": 6,
        "$ai_latency": 0.84,
        "$ai_http_status": 200
      }
    }]
  }'
```

### Flareboard 读取的 PostHog 属性

| PostHog 属性 | 存储为 | 说明 |
| --- | --- | --- |
| 事件名：`$ai_generation`、`$ai_span`、`$ai_trace`、`$ai_embedding` | 类型：`generation`、`span`、`trace`、`embedding` | `$ai_trace` 本身就是一个 span |
| `$ai_trace_id`、`$ai_span_id`、`$ai_parent_id` | 调用链 ID、span ID、父 span ID | |
| `$ai_span_name`（或 `$ai_trace_name`） | span 名称 | |
| `$ai_model`、`$ai_provider` | 模型、提供方 | 提供方会转成小写 |
| `$ai_input_tokens`、`$ai_output_tokens` | 输入、输出和总 token | |
| `$ai_cache_read_input_tokens`、`$ai_cache_creation_input_tokens` | 缓存读取和缓存写入 token | |
| `$ai_reasoning_tokens` | 推理 token | |
| `$ai_total_cost_usd`（或 `$ai_input_cost_usd` 加 `$ai_output_cost_usd`） | 以美元计的成本 | 你发送的成本会原样使用 |
| `$ai_latency` | 延迟 | PostHog 中以秒为单位，存储时为毫秒 |
| `$ai_http_status`、`$ai_is_error`、`$ai_error` | HTTP 状态、状态、错误消息 | 调用在以下情况视为错误：`$ai_is_error` 为 true；否则 HTTP 状态为 400 或以上；否则设置了 `$ai_error` |
| `$ai_input` 或 `$ai_input_state` | 提示词内容 | 见 [内容](#内容) |
| `$ai_output_choices`、`$ai_output` 或 `$ai_output_state` | 响应内容 | 见 [内容](#内容) |

其他值为纯字符串、数字或布尔值的 `$ai_*` 属性（例如 `$ai_stream`）以及你自己的属性都会原样保留。`$ai_tools` 不会被存储。`$ai_metric` 和 `$ai_feedback` 事件会作为普通的自定义事件存储。

## 2. 用 `flareboard.ai()` 发送 LLM 调用

在浏览器中，使用追踪脚本或 npm 包：

```js
flareboard.ai({
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 4000,
  latencyMs: 2100,
  traceId: 'conversation-42',
  spanId: 'answer',
  parentSpanId: 'conversation-42',
  input: [{ role: 'user', content: '…' }],
  output: '…',
});
```

调用 `flareboard.identify()` 之后，这次调用会归属到该用户。否则，Flareboard 会把它归到匿名访客名下。

在服务端，向 `/api/send` 发送 `"type": "ai"`：

```bash
curl -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "ai",
    "payload": {
      "website": "YOUR_PROJECT_KEY",
      "id": "user_123",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "inputTokens": 1200,
      "outputTokens": 300,
      "latencyMs": 2100,
      "traceId": "conversation-42",
      "status": "success"
    }
  }'
```

响应是 `200`。该端点的其余内容（批量发送、限制、`id` 如何归属调用）见 [从服务端发送事件](/docs/zh/install/server)。

### 字段

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `kind` | `generation`（默认）、`span`、`trace` 或 `embedding` | 这条记录是什么。不是模型调用的步骤，用 `span` 或 `trace` |
| `model` | 字符串，最多 120 个字符 | 模型 ID。定价需要它。没有模型的 generation 会记在 `name` 下，或记为 `unknown` |
| `provider` | 字符串，最多 80 个字符 | 例如 `openai` 或 `anthropic` |
| `name` | 字符串，最多 50 个字符 | 事件名 |
| `inputTokens`、`outputTokens` | 整数 | token 数。省略 `totalTokens` 时，它等于两者之和 |
| `totalTokens`、`cacheReadTokens`、`cacheWriteTokens` | 整数 | 可选的 token 数 |
| `costUsd` | 数字 | 以美元计的成本。省略则由 Flareboard 为这次调用定价 |
| `latencyMs` | 整数 | 耗时，单位为毫秒 |
| `status` | `success`（默认）或 `error` | 结果 |
| `message` | 字符串 | `status` 为 `error` 时的错误消息 |
| `traceId`、`spanId`、`parentSpanId` | 字符串，最多 200 个字符 | 构建调用链的树 |
| `operation` | 字符串，最多 200 个字符 | span 名称 |
| `quality` | 字符串，最多 80 个字符 | 可用于筛选的标签 |
| `input`、`output` | 任意 JSON | 提示词和响应。见 [内容](#内容) |
| `release`、`environment` | 字符串 | 部署上下文 |
| `data` | 对象 | 额外属性 |
| `id` | 字符串，最多 128 个字符 | 这次调用所属的用户。浏览器脚本会根据 `identify()` 自动填入 |

## 3. Flareboard 记录什么

每次调用会记录：模型和提供方、输入、输出、缓存和推理 token、成本、延迟、状态和错误消息、它在调用链中的位置，以及背后的用户和会话。失败的调用会计入错误率，并保留其错误消息。

### 内容

提示词和响应（`input` 和 `output`）各最多存储 32 KB。更长的内容会被截断，末尾带有一个标记，说明原内容有多少字节。调用链视图会显示一个已截断的徽标。

提示词里可能包含个人数据。要停止存储它们，打开 **AI 可观测**，进入 **设置**，关闭 **存储提示词和响应**。此后 Flareboard 只保留元数据：模型、token、成本、延迟、状态和调用链 ID。这一更改大约一分钟内对新事件生效。已存储的内容会保留，直到网站的数据保留期将其清除。封装自带的隐私模式（Python 中的 `posthog_privacy_mode`，Node 中的 `posthogPrivacyMode`）则能让内容根本不离开你的服务器。

### 成本如何计算

成本是在你查看时计算的，而不是在调用到达时，所以修正价格后，过去的数字也会随之改变，无需重新导入。对每次调用：

1. 随调用发送的成本（`costUsd`、`$ai_total_cost_usd`，或输入与输出成本相加）会原样使用。
2. 否则，使用你为该模型设置的价格，位置在 **AI 可观测**、**设置**、**模型价格**。价格以每 100 万 token 的美元数计，不带日期的模型 ID 会匹配它所有带日期的版本。
3. 否则，使用 Flareboard 内置的该模型标价。

没有价格的模型显示为 **未定价**，并且不计入成本。它绝不会按相似的名称去猜价格。要把它计入，请在 **模型价格** 下添加价格（点击 **添加价格**，然后设置 **模型 ID**、**输入 / 1M**、**输出 / 1M**，以及可选的 **缓存读取 / 1M** 和 **缓存写入 / 1M**）。

模型 ID 会先规范化再匹配：转为小写，去掉 `openai/` 之类的厂商前缀、Bedrock 和 Vertex 的修饰、日期后缀或 `-latest`。

缓存 token：对大多数模型（OpenAI、Gemini 等），缓存 token 已计入输入 token，所以 Flareboard 按缓存价格计费，并把它们从普通输入中扣除。对 Claude 模型，它们是单独上报的，除非提供方是 `openai`、`openrouter`、`litellm` 或 `azure`，这些提供方按 OpenAI 的方式上报 Claude 的用量。如果模型没有缓存价格，缓存 token 按输入价格计费。

DeepSeek 在非高峰时段半价。内置标价使用高峰价格，所以除非你设置自己的价格，否则 DeepSeek 的成本是一个上限。

## 4. 查看数据

打开网站，再打开 **AI 可观测**（在 **质量** 下）。在顶部选择日期范围。共有四个标签：

- **概览**：**成本**、**生成次数**（附调用链数量）、**Token**、**p50 延迟**（附 p95）、**错误率** 和 **用户**。下方是成本、生成次数和错误的图表，以及延迟（p50 和 p95）图表，然后是 **各模型成本**、一个 **模型** 表（模型、提供方、生成次数、输入和输出 token、成本、错误率、平均延迟）和一个 **分布**。可以按模型、提供方、状态、版本、环境和质量筛选。只有存在多个可选值时才会出现筛选项。
- **追踪**：每条调用链的开始时间、延迟、生成次数、token、成本、用户和状态。可以按模型、用户、错误状态和成本范围（**最低成本（$）**、**最高成本（$）**）筛选。没有调用链 ID 的调用自成一条调用链。打开一条调用链，可以看到其步骤的 **时间线**。选中一个步骤，可以看到它的 **输入**、**输出** 和 **属性**。
- **用户**：每个用户的成本和用量，包括生成次数、调用链、token、错误、模型和最近出现时间。匿名访客按访客分组。**查看追踪** 会打开该用户的调用链。
- **设置**：**存储提示词和响应** 和 **模型价格**。修改它们需要网站的编辑权限。

## 检查是否生效

1. 用第 2 步的 `curl` 示例发送一次调用，使用你自己的项目密钥。
2. 确认响应是 `200`。
3. 打开 **AI 可观测**。这次调用会在几秒内显示在 **概览** 中。如果它的模型显示为 **未定价**，请在 **设置** 下添加价格。

## 故障排查

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| **当前时间范围内没有 AI 调用** | 没有数据到达，或日期范围太窄 | 放宽范围。检查 SDK 中的 host 和密钥 |
| `400` `Website not found.` | 项目密钥错误或已被轮换 | 从 **设置** 重新复制 **项目 API 密钥** |
| 成本显示 **未定价** | 模型 ID 不在内置列表中，你也没有设置价格 | 在 **模型价格** 下添加价格，或发送 `costUsd` |
| 调用链中缺少提示词 | **存储提示词和响应** 已关闭 | 打开它。只对新事件生效 |
| `402` `Monthly event limit exceeded.` | 套餐的月度事件额度已用完（仅 Cloud） | 等到下个月，或更换套餐 |
