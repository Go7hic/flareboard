---
title: 使用 PostHog SDK
sidebarTitle: PostHog SDK
description: 只需更改 API 密钥和 host，就能让 posthog-js、posthog-node、posthog-python 以及 PostHog 的 LLM 封装库把数据发送到 Flareboard。
---

Flareboard 的采集地址兼容了足够多的 PostHog capture 和 flags API，PostHog SDK 可以直接向它发送数据。如果你的代码已经在使用 PostHog，只需改两项设置，其余保持不变：API 密钥换成网站的 [项目密钥](/docs/zh/concepts#项目密钥)，host 换成你的 Flareboard 采集地址。

## 开始之前

- Flareboard 中的一个网站。见 [快速开始](/docs/zh/quickstart)。
- 它的项目密钥。打开 **网站**，进入网站的 **设置**，**项目 API 密钥** 卡片会显示它（以 `fb_pk_` 开头）。安装代码的 **PostHog SDK** 标签页显示的就是下面这些代码，并已填入你的密钥。
- 采集地址：在 Flareboard Cloud 上是 `https://t.flareboard.dev`。如果你自托管，请使用你自己的采集地址（即提供 `script.js` 的那个 host）。

示例中用 `YOUR_PROJECT_KEY` 表示密钥。项目密钥是公开的，放在浏览器代码里没有问题。

## 1. posthog-js（浏览器）

安装 npm 包，并设置 `api_host`：

```ts
import posthog from 'posthog-js'

posthog.init('YOUR_PROJECT_KEY', {
  api_host: 'https://t.flareboard.dev',
  person_profiles: 'identified_only',
  // 会话录制和问卷由 Flareboard 提供，而不是 PostHog SDK
  disable_session_recording: true,
  disable_surveys: true,
})
```

请使用 npm 包，不要用 PostHog 的 CDN 代码。CDN 代码会从 `api_host` 加载额外的代码（录制器、问卷、Web Vitals），而 Flareboard 不提供这些文件。

设置 `person_profiles: 'identified_only'` 后，匿名访客不会有用户档案，档案会在你调用 `posthog.identify()` 时出现。

## 2. posthog-node（服务端）

```ts
import { PostHog } from 'posthog-node'

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' })

posthog.capture({ distinctId: 'user_123', event: 'subscription_renewed', properties: { plan: 'pro' } })
const variant = await posthog.getFeatureFlag('checkout.new_flow', 'user_123')

await posthog.shutdown()
```

在进程退出前调用 `shutdown()`，以便发送队列中的事件。

不支持本地开关评估（`personalApiKey`）。开关由 Flareboard 在每次调用时远程评估。

## 3. posthog-python（服务端）

```python
from posthog import Posthog

posthog = Posthog('YOUR_PROJECT_KEY', host='https://t.flareboard.dev')
posthog.capture(distinct_id='user_123', event='subscription_renewed', properties={'plan': 'pro'})
posthog.shutdown()
```

其他 PostHog 服务端 SDK（Ruby、Go、PHP、Java 等）使用同样的 `/batch/` 和 `/flags/` 调用，用同样的方式设置密钥和 host 应该也能工作。

## 支持的功能

| PostHog | Flareboard 的处理 |
| --- | --- |
| 自定义事件 | 连同属性一起存为自定义事件。 |
| `$pageview` | 页面浏览。URL 取自 `$current_url`，来源页取自 `$referrer`，标题取自 `$title`。 |
| `$pageleave`、`$autocapture`、`$rageclick`、`$feature_flag_called` | 存为自定义事件。 |
| `$identify`、`$set`、`$set_once` | 创建或更新用户。`$set_once` 不会覆盖已有的值。`$identify` 还会把 `$anon_distinct_id` 与已识别的 ID 关联起来。 |
| `$create_alias`、`$merge_dangerously` | 把别名与主 ID 关联。 |
| `$groupidentify`，以及任意事件上的 `$groups` | 分组属性和分组成员关系。 |
| `$exception` | 一个错误事件，包含消息、类型、堆栈、来源、行号、列号、级别，以及是否已被处理。见 [错误追踪](/docs/zh/error-tracking)。 |
| `$web_vitals` | 性能数据：LCP、INP、CLS 和 FCP。 |
| `$ai_generation`、`$ai_span`、`$ai_trace`、`$ai_embedding` | AI 事件。见 [LLM 封装库](#llm-封装库)。 |
| 功能开关 | 由 Flareboard 通过 `/flags` 和 `/decide` 评估。布尔开关返回 `true` 或 `false`，带变体的开关返回变体键。开关有 payload 时会一并返回。见 [功能开关](/docs/zh/feature-flags)。 |

需要注意的细节：

- **一个请求对应一个网站。** 带有其他项目密钥的事件会被丢弃。
- **属性。** 先存储你自己的属性，再存储值得保留的 PostHog 属性（如 `$lib`、`$feature/*` 和 `$ai_*`）。只保留字符串、数字和布尔值，每个事件最多 100 个键。
- **隐私。** `$ip` 和 `$raw_user_agent` 永远不会被存储。
- **浏览器与设备。** 取自 `$browser`、`$os`、`$device_type`、`$screen_width`、`$screen_height` 和 `$browser_language`，其次取自 user agent。
- **位置。** 只有来自浏览器的请求才有国家和城市。服务端 SDK 请求的位置是你服务器的位置，所以服务端事件没有位置信息。
- **重试。** 事件 ID 由 PostHog 事件的 `uuid` 派生，因此 SDK 重试不会产生重复事件。
- **时间。** 当请求中说明了发送时间时，`timestamp` 会按时钟偏差进行修正。落在过去 90 天之前或未来 5 分钟之后的时间，会被替换为接收时间。
- **访客与访问。** 访客由 PostHog 的 `distinct_id` 派生，访问由 `$session_id` 派生，所以同一用户的追踪器事件和 SDK 事件可以对齐。见 [概念](/docs/zh/concepts#访问与会话)。
- **匿名用户。** 当 `$process_person_profile: false`（`person_profiles: 'identified_only'` 对匿名用户发送的就是它）时，不会创建或更新任何用户。

## 不支持的功能

- 通过 PostHog SDK 进行 **会话录制**。请使用 Flareboard 自己的录制器：见 [会话回放](/docs/zh/session-replay)。`$snapshot` 和 `$performance_event` 事件会被忽略。
- 通过 PostHog SDK 使用 **问卷**。请使用 [Flareboard 问卷](/docs/zh/surveys)。
- 热力图、站点应用、PostHog 工具栏和 Web 实验。Flareboard 返回给 posthog-js 的配置会把它们关闭，同一份配置也会关闭 posthog-js 的自动异常采集。
- 本地开关评估，以及 PostHog 的管理 API（`/api/projects/...`）。要在代码中读取或修改 Flareboard 的数据，请使用带个人 API 密钥的 [REST API](/docs/zh/api)。
- 旧版 `lz64` 压缩。请使用 gzip、base64 或纯 JSON。
- `$unset`，以及别名之外的分组级用户合并。
- 收入。PostHog 事件没有标准的收入字段，所以不会记录收入。

## LLM 封装库

PostHog 的 LLM 封装库使用相同的密钥和 host 时即可工作。它们会发送 `$ai_generation`、`$ai_span`、`$ai_trace` 和 `$ai_embedding` 事件，这些事件显示在 **AI 可观测** 下。

```python
from posthog import Posthog
from posthog.ai.openai import OpenAI

posthog = Posthog('YOUR_PROJECT_KEY', host='https://t.flareboard.dev')
client = OpenAI(api_key='YOUR_OPENAI_API_KEY', posthog_client=posthog)

response = client.chat.completions.create(
    model='gpt-4o-mini',
    messages=[{'role': 'user', 'content': 'What is Flareboard?'}],
    posthog_distinct_id='user_123',      # 这次调用归属的用户
    posthog_trace_id='conversation-42',  # 把多次调用归入同一条链路
)
posthog.shutdown()
```

```ts
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

Anthropic 和 Gemini 的封装库以及 LangChain 回调处理器的用法相同。提示词和响应各最多存储 32 KB。如果不想存储它们，可以在网站的 AI 可观测设置中关闭 **存储提示词和响应**，或使用封装库的隐私模式，让内容永远不会离开你的服务器。见 [LLM 分析](/docs/zh/llm-analytics)。

## 检查是否生效

用 `curl` 发送一个事件：

```bash
curl -X POST https://t.flareboard.dev/capture/ \
  -H 'Content-Type: application/json' \
  -d '{"api_key": "YOUR_PROJECT_KEY", "event": "posthog_test", "distinct_id": "user_123"}'
```

响应是 `{"status":1}`。然后打开该网站的 **事件**，查找 `posthog_test`。你实际 SDK 配置发出的事件也会出现在那里。

## 限制

| 限制 | 值 |
| --- | --- |
| 传输中的请求体 | 2 MB |
| 解压后的请求体 | 8 MB |
| 每个请求的事件数 | 1,000 |
| 每个项目密钥的请求数 | 默认每分钟 30,000 次，另有一份同样大小、专用于开关请求的额度 |

自托管用户可以通过采集服务的 `PROJECT_KEY_RATE_LIMIT` 变量修改每个密钥的限制。在 Flareboard Cloud 上，事件还会计入你套餐的每月额度。见 [套餐与限额](/docs/zh/plans-limits)。请求格式和所有路由见 [采集 API 参考](/docs/zh/reference/ingest-api)。

## 故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `401`，带有 `invalid_api_key` | 密钥缺失、拼写有误，或已被轮换。 | 从网站的 **设置** 中重新复制密钥。 |
| `400`，带有 `No valid events` | 每个事件都需要事件名称和 `distinct_id`。 | 检查你的代码发送的事件。 |
| `402` | 本月事件额度已用完。 | 等到下个月，或更换套餐。 |
| `429` | 超过了项目密钥的限流。 | 减少请求次数，改为发送更大的批次。 |
| posthog-js 尝试加载文件并失败 | 你使用了 CDN 代码。 | 改用 npm 包。 |
