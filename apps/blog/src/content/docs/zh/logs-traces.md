---
title: 日志与调用链
description: 通过 OTLP/HTTP 把 OpenTelemetry 日志和调用链发送到 Flareboard，或从浏览器写日志，然后在控制台中搜索、实时跟踪并设置告警。
---

Flareboard 是一个 OTLP/HTTP 接收端。把任意 OpenTelemetry SDK 或 OpenTelemetry Collector 指向你的采集地址，后端的日志和调用链就会出现在网站的 **日志** 页面上，与浏览器里用 `flareboard.log()` 发送的日志行放在一起。你可以搜索它们、查看一条调用链、跳转到某一行背后的访客会话，并在某类日志变得频繁时收到告警。

## 开始之前

- Flareboard 中的一个网站。见 [快速开始](/docs/zh/quickstart)。
- 它的 **项目密钥**（`fb_pk_…`）。打开 **网站**，进入网站的 **设置**，**项目 API 密钥** 卡片会显示它。见 [核心概念](/docs/zh/concepts#项目密钥)。
- 采集地址：Flareboard Cloud 上是 `https://t.flareboard.dev`，自托管请使用你自己的地址。
- 仅自托管：OTLP 需要按网站划分的存储（`EVENT_STORE` 设为 `dual` 或 `do`）。在旧的 `d1` 模式下，这些端点会返回 `501`。

## 1. 通过 OTLP 发送日志和调用链

### 端点

| 信号 | 方法和 URL | Content-Type |
| --- | --- | --- |
| 日志 | `POST https://t.flareboard.dev/v1/logs` | `application/x-protobuf` 或 `application/json` |
| 调用链 | `POST https://t.flareboard.dev/v1/traces` | `application/x-protobuf` 或 `application/json` |

两者都支持 `Content-Encoding: gzip`。不支持 gRPC，请使用 `http/protobuf` 或 `http/json` 协议。不接受指标（`/v1/metrics`）。

### 认证

用下面两个请求头之一发送项目密钥：

- `Authorization: Bearer YOUR_PROJECT_KEY`
- `x-flareboard-key: YOUR_PROJECT_KEY`

这里不接受网站 ID。如果你在 **设置** 中轮换了密钥，旧密钥会在几分钟内失效。项目密钥按设计是公开的（追踪脚本用的是同一个），所以放进浏览器端的代码包也没有问题。

### 环境变量

所有 OpenTelemetry SDK 都会读取标准的导出器变量：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://t.flareboard.dev
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20YOUR_PROJECT_KEY"
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_SERVICE_NAME=checkout-api
OTEL_RESOURCE_ATTRIBUTES="service.version=2.4.1,deployment.environment.name=production"
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=none
```

SDK 会自己在端点后面加上 `/v1/logs` 和 `/v1/traces`。`OTEL_EXPORTER_OTLP_HEADERS` 中的请求头值需要 URL 编码，所以 `Bearer` 后面的空格写成 `%20`。Flareboard 两种写法都接受。如果你更喜欢 JSON，可以用 `http/json` 代替 `http/protobuf`，但 Python SDK 除外，它在 HTTP 上只导出 `http/protobuf`。

### Node.js

安装 OpenTelemetry 自动插桩包，设置上面的变量，并在启动应用时预加载它：

```bash
npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node
NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" node server.js
```

### Python

安装 OpenTelemetry distro、OTLP HTTP 导出器，以及你的应用所用库对应的插桩包，设置上面的变量，并通过 `opentelemetry-instrument` 启动应用：

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http
opentelemetry-bootstrap -a install
export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
opentelemetry-instrument python app.py
```

### OpenTelemetry Collector

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  batch:
    send_batch_size: 2048
    send_batch_max_size: 4096   # 保持在每个请求 10,000 条记录的上限以内
    timeout: 5s

exporters:
  otlphttp/flareboard:
    endpoint: https://t.flareboard.dev
    headers:
      Authorization: Bearer YOUR_PROJECT_KEY
    compression: gzip
    encoding: proto             # 或 json

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/flareboard]
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/flareboard]
```

### curl

用 JSON 发送一条日志记录。时间戳必须在最近 30 天内：

```bash
curl -X POST https://t.flareboard.dev/v1/logs \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PROJECT_KEY' \
  -d '{
    "resourceLogs": [{
      "resource": { "attributes": [
        { "key": "service.name", "value": { "stringValue": "checkout-api" } },
        { "key": "deployment.environment.name", "value": { "stringValue": "production" } }
      ] },
      "scopeLogs": [{
        "scope": { "name": "manual-test" },
        "logRecords": [{
          "timeUnixNano": "'"$(date +%s)"'000000000",
          "severityNumber": 17,
          "severityText": "ERROR",
          "body": { "stringValue": "Payment failed" },
          "attributes": [ { "key": "order.id", "value": { "stringValue": "ord_123" } } ]
        }]
      }]
    }]
  }'
```

用同样的方式向 `/v1/traces` 发送一个 span：

```bash
curl -X POST https://t.flareboard.dev/v1/traces \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PROJECT_KEY' \
  -d '{
    "resourceSpans": [{
      "resource": { "attributes": [
        { "key": "service.name", "value": { "stringValue": "checkout-api" } }
      ] },
      "scopeSpans": [{
        "scope": { "name": "manual-test" },
        "spans": [{
          "traceId": "5b8efff798038103d269b633813fc60c",
          "spanId": "eee19b7ec3c1b174",
          "name": "POST /checkout",
          "kind": 2,
          "startTimeUnixNano": "'"$(date +%s)"'000000000",
          "endTimeUnixNano": "'"$(date +%s)"'250000000",
          "status": { "code": 1 }
        }]
      }]
    }]
  }'
```

请求成功会返回 `200` 和一个空的 JSON 对象（`{}`）。

### OpenTelemetry 字段如何映射

| OpenTelemetry | 在 Flareboard 中 |
| --- | --- |
| 资源属性 `service.name`、`service.version` | 服务和版本 |
| 资源属性 `deployment.environment.name`（或 `deployment.environment`） | 环境 |
| 其他资源属性 | 显示在日志详情的 **资源属性** 下，可用于筛选 |
| `severityNumber`（1 到 4 为 trace，21 到 24 为 fatal），否则看 `severityText`，再否则为 info | 级别：`trace`、`debug`、`info`、`warn`、`error` 或 `fatal` |
| `body` | 消息。不是字符串的 body 会按 JSON 存储 |
| 日志和 span 的属性 | 属性，可按 `key=value` 筛选 |
| `traceId`、`spanId` | 把一行日志关联到它的调用链 |
| 属性 `session.id`、`session_id` 或 `$session_id`（先看记录，再看资源） | 把这行日志或调用链关联到一个 Flareboard 会话及其回放 |
| 插桩范围（instrumentation scope） | Scope，格式为 `name@version` |
| span 的名称、类型、开始和结束时间、状态、事件和链接 | Span 瀑布图和 span 详情 |

时间戳依次取自 `timeUnixNano`、`observedTimeUnixNano`，最后是接收时间。时间戳比现在晚超过一天的记录，会按接收时间存储。早于 30 天的记录会被拒绝，并在 `partialSuccess` 中报告。

### 限制

| 限制 | 值 |
| --- | --- |
| 请求体，压缩与否均计 | 4 MB |
| 解压后的请求体 | 8 MB |
| 每个请求的日志记录或 span 数 | 10,000（超过返回 `413`） |
| 每条记录、span、事件或链接的属性数 | 128。多出的会被丢弃。记录和 span 上的丢弃会在 `partialSuccess` 中报告 |
| 属性键长度 | 256 个字符 |
| 属性值长度 | 4,096 个字符 |
| 日志 body 长度 | 32 KB |
| 每个 span 的事件数和链接数 | 各 128 |
| 每个项目密钥的请求数 | 默认每分钟 30,000，与事件采集的额度分开计算。自托管可通过 `PROJECT_KEY_RATE_LIMIT` 修改 |

### 响应

响应遵循 OTLP/HTTP 规范，编码与你的请求一致。

- `200`：已存储。如果部分记录被拒绝或部分属性被丢弃，响应体会带有 `partialSuccess`，其中包含 `rejectedLogRecords`（或 `rejectedSpans`）和 `errorMessage`。
- `400`：请求体格式错误。
- `401`：缺少项目密钥，或密钥未知。
- `402`：本月的日志和 span 额度已用完（仅 Cloud）。
- `413`：请求过大。
- `415`：不支持的 `Content-Type` 或 `Content-Encoding`。
- `429`：被限流，响应带有 `Retry-After` 头。
- `501`：此部署不提供 OTLP。
- `503`：存储暂时不可用，响应带有 `Retry-After` 头。

导出器只会重试 `429` 和 `503`。重试是安全的：日志记录的 ID 由其内容和它在批次中的位置得出，所以重发的批次不会被重复存储，重发的 span 会替换之前的副本。

## 2. 从浏览器发送日志

安装追踪脚本后，调用 `flareboard.log()`：

```js
flareboard.log('error', 'Checkout failed', { step: 'payment' });
```

签名是 `flareboard.log(level, message, data)`。`level` 是 `trace`、`debug`、`info`、`warn`、`error` 或 `fatal` 之一。这些日志行的来源显示为 **浏览器**，并带有访客的会话，所以你可以从日志行打开对应的会话。npm 包里有相同的调用，见 [npm 包](/docs/zh/install/npm)。

如果服务端没有使用 OpenTelemetry，你可以向 `/api/send` 发送 `"type": "log"` 来发送同样的日志行。见 [从服务端发送事件](/docs/zh/install/server)。

不要把密码、令牌或个人数据放进日志消息或属性。

## 3. 在控制台中查找日志

打开网站，再打开 **日志**（在 **质量** 下）。在顶部选择日期范围。数据分三个标签显示。

### 探索

- 顶部的概览条显示当前范围和筛选条件下的 **日志行**、**错误日志**、**警告日志** 和 **影响会话**。
- **日志量** 图表按级别显示随时间变化的日志行数。点击某个级别即可按它筛选。
- 工具栏可以按消息文本（不区分大小写的子串）、服务、环境、版本和来源（**OpenTelemetry** 或 **浏览器**）筛选。要按属性筛选，在属性框中输入 `key=value`，然后点击 **添加属性筛选**。只写键、不写值，则匹配设置了该属性的日志行。生效的筛选条件显示为可移除的标签，点击 **重置** 可全部清除。
- 点击一行打开 **日志详情**，其中有消息、属性、资源和 scope。**查看链路** 会打开它的调用链。当这一行带有会话 ID 时，**打开会话与回放** 会打开访客的会话。
- 底部的 **加载更早的日志** 会取下一页。

### 实时跟踪

**实时跟踪** 按到达顺序显示新到的日志行，每两秒检查一次。它保留最新的 1,000 行，并遵循你设置的筛选条件。用 **暂停**、**继续** 和 **清空** 来控制。

### 调用链

**链路** 列出由 OpenTelemetry span 构建的调用链，以及带有 `traceId` 的浏览器日志行。可以按 span 名称搜索，或打开 **仅错误**。点击一条调用链，可以看到 **Span 瀑布图**、span 的属性和事件，以及 **此链路的日志**。

## 4. 保存筛选

在 **探索** 中设置好筛选条件，点击 **保存筛选**（或打开 **已保存筛选**），输入名称并保存。**应用** 会把已保存的筛选重新载入 **探索**。保存和删除需要网站的编辑权限。

## 5. 对日志量设置告警

1. 打开 **日志**，再打开 **告警规则**，然后点击 **新建规则**。
2. 填写：
   - **规则名称**。
   - **阈值**：匹配的日志行数（1 到 100,000）。
   - **窗口（分钟）**：1 到 10,080。
   - 可选筛选：**日志级别**、**服务**、**搜索**、**属性**（`key=value`）、**版本**、**环境**。
   - **通道**：**仅记录**、**邮件** 或 **Webhook**。选后两者时，把 **目标** 设为邮箱地址或 webhook URL。
3. 点击 **创建告警规则**。

当窗口内匹配的日志行数达到阈值时，规则就会触发。规则每小时检查一次。规则触发后，要等它的窗口过去才会再次触发。**仅记录** 只存储告警，不发送任何内容。

webhook 告警是一个带 JSON 请求体的 `POST`：

```json
{
  "type": "log_alert",
  "websiteId": "YOUR_WEBSITE_ID",
  "ruleName": "Checkout errors",
  "count": 42,
  "threshold": 20,
  "windowMinutes": 60
}
```

webhook URL 必须是公网的 `http` 或 `https` 地址。私有地址、回环地址和内部主机会被拒绝。

## 数据保留与额度

- OpenTelemetry 日志和 span 保留 30 天，如果网站的数据保留期更短，则按更短的算。
- 浏览器日志行作为事件存储，遵循网站的事件保留期。

在 Flareboard Cloud 上，日志记录和 span 有各自的月度额度，按账号统计所有网站的总量，与产品事件分开计算：

| 套餐 | 每月日志与 span 数 |
| --- | --- |
| Free | 50,000 |
| Cloud | 500,000 |
| Business | 5,000,000 |

Free 套餐达到额度后停止采集。Cloud 和 Business 套餐可以继续采集到额度的 120%，之后停止，直到下个月。在 80%、100% 以及停止采集时，你会收到邮件。停止采集后，OTLP 请求会返回 `402`。用量显示在 **订阅** 页面的 **日志与 Span** 下。用 `flareboard.log()` 发送的日志行则计入你的月度事件。自托管安装没有套餐限制。

## 检查是否生效

1. 发送第 1 步中的日志 `curl` 请求，或启动你已插桩的应用。
2. 确认响应是 `200`。
3. 打开该网站的 **日志**。日志行会在几秒内出现。在 **实时跟踪** 中，它会在到达时立即显示。

在还没有日志的网站上，只要部署支持 OTLP，**日志** 页面就会显示要使用的环境变量。

## 故障排查

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| `401` | 密钥缺失、错误或已被轮换。 | 从 **设置** 重新复制 **项目 API 密钥**。这里不能使用网站 ID。 |
| `415` | 不支持该 content type 或编码。 | 使用 `application/json` 或 `application/x-protobuf`，配合 gzip 或不压缩。 |
| `501` | 此部署没有使用按网站划分的存储。 | 自托管：把 `EVENT_STORE` 设为 `dual` 或 `do`。 |
| `402` | 本月的日志和 span 额度已用完。 | 等到下个月，或更换套餐。见 [套餐与限制](/docs/zh/plans-limits)。 |
| 返回 `200`，但 `partialSuccess` 列出了被拒绝的记录 | 时间戳早于 30 天，或 ID 无效。 | 修正时间戳或 ID 后重新发送。 |
| 导出器没有报错，但什么都没出现 | SDK 使用的是 gRPC，或端点被重复加了路径。 | 把协议设为 `http/protobuf` 或 `http/json`，并使用不带路径的采集地址作为端点。 |
