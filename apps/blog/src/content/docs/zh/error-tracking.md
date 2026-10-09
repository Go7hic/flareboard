---
title: 错误追踪
description: 捕获未处理的 JavaScript 错误和你自己处理过的异常，按堆栈把它们归为问题，用 source map 读取可读的堆栈，并在错误激增或再次出现时收到告警。
---

追踪脚本会自动上报未捕获的错误和未处理的 promise 拒绝。Flareboard 把这些发生记录归入问题，让你可以把问题标记为已解决或忽略，并把每次发生链接到它所在的会话。加上 source map 之后，堆栈显示的是你的原始代码，而不是压缩后的打包文件。

所有套餐都提供错误追踪。

## 开始之前

- 在你想监控的页面上安装 [追踪脚本](/docs/zh/install/script) 或 [npm 包](/docs/zh/install/npm)。
- 设置版本和环境，这样你可以区分各个版本，并匹配 source map。见 [设置版本和环境](#1-设置版本和环境)。
- 要编辑问题、上传 source map 或创建告警，请使用可以编辑该网站的账号。只有查看权限的账号可以阅读所有内容。

## 会捕获什么

不写任何代码，脚本就会发送：

- 页面上抛出的未捕获错误（`window` 的 `error` 事件），包括消息、错误名称、堆栈（最多 12,000 个字符）、源文件、行号和列号；
- 未处理的 promise 拒绝（`unhandledrejection`），包括原因的消息、名称和堆栈。

两者都以 `handled: false` 和严重级别 `error` 存储。图片、脚本或样式加载失败不会被上报。访客已退出，或遵循了 Do Not Track 的浏览器不会发送任何内容。同意与退出的机制见 [隐私与数据](/docs/zh/privacy-data)。

来自 [PostHog SDK](/docs/zh/install/posthog) 的错误也会到达：PostHog 的 `$exception` 事件会被存储为一个错误。

消息和堆栈会按发送的原样存储。请不要把邮箱、令牌和其他个人数据放进错误消息，也不要放进你附加的 `data`。

## 1. 设置版本和环境

在 script 标签上添加 `data-release` 和 `data-environment`。版本请使用每次部署都会变化的值，例如 git commit。

```html
<script
  defer
  src="https://t.flareboard.dev/script.js"
  data-website-id="YOUR_WEBSITE_ID"
  data-release="YOUR_RELEASE"
  data-environment="production"
></script>
```

使用 npm 包时，请改为把 `release` 和 `environment` 传给 `flareboard.init()`。自托管用户请把 `t.flareboard.dev` 换成自己的采集地址。

版本最长 200 个字符，环境最长 100 个字符。采集服务会拒绝值更长的事件。

版本和环境会随脚本发送的每个事件、错误和日志一起发送。它们会填充 **错误** 页面上的 **全部版本** 和 **全部环境** 筛选，并决定使用哪些 source map。

## 2. 自己捕获错误

对你捕获到的错误使用 `captureException`，例如失败的结账请求。

```ts
import { flareboard } from '@flareboard/js';

try {
  await submitOrder();
} catch (error) {
  flareboard.captureException(error, {
    severity: 'warning',
    data: { step: 'payment' },
  });
}
```

使用 script 标签时，调用 `window.flareboard.captureException(error, context)`。第二个参数是可选的。

| 选项 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `severity` | `'fatal'`、`'error'`、`'warning'` 或 `'info'` | `'error'` | 错误的严重程度。告警可以按它筛选。 |
| `handled` | boolean | `true` | 你捕获的错误为 `true`，漏掉的错误为 `false`。 |
| `release` | string | `data-release` | 覆盖这条错误的版本。 |
| `environment` | string | `data-environment` | 覆盖这条错误的环境。 |
| `data` | object | 无 | 随错误一起存储的额外属性。 |

你可以传入一个 `Error`，也可以传入字符串。脚本加载完成之前发出的调用，会由 npm 包排队，并在脚本就绪后发送。

## 3. 错误如何归入问题

每次发生都会得到一个指纹，指纹相同的发生记录构成一个问题。问题页面会说明它是如何分组的。

1. 自定义指纹优先。你把 `data` 中的 `$exception_fingerprint` 设为一个字符串，或一个由字符串和数字组成的数组（合计最多 500 个字符）。
2. 否则，Flareboard 按错误类型加上最多五个来自你自己代码的堆栈帧分组。它会忽略内置帧、浏览器扩展、`node_modules`、`vendor` 文件夹、打包工具的 vendor 分块、常见的库文件和知名的第三方主机。文件路径和函数名会被规范化，使构建哈希和数字不会把一个问题拆开。
3. 没有可用堆栈时，按错误类型和消息分组。消息中的 ID、数字、UUID、邮箱、十六进制值和带引号的值会在分组前被替换。

要把两个不同的失败强行归为一个问题，或者让某一个保持独立，请设置你自己的指纹：

```ts
flareboard.captureException(error, {
  data: { $exception_fingerprint: 'checkout-payment-declined' },
});
```

你也可以事后合并问题。在 **错误** 页面中，勾选两个或更多问题，在 **合并到** 下选择目标，然后点击 **合并**。它们的事件（包括之后的事件）都会计入目标。目标保留它的状态、负责人和评论。在目标问题的页面上，点击 **已合并的问题** 下该问题旁的 **取消合并**，即可把它重新拆分出来。

## 4. 处理问题

打开你的网站，然后在侧边栏中打开 **错误**。

- 顶部的数字块显示你所选日期范围内的 **错误问题**、**发生次数**、**影响会话** 和 **无错误会话**。
- **错误问题** 列出最频繁的 25 个问题，以及它们的状态、**发生次数**、**用户** 和 **最近一次**。点击其中一个可以打开它。
- **最近错误** 列出单次发生的错误。点击一个可以查看它的属性、解析后的堆栈和 **查看会话** 链接。
- 可以按状态（默认是 **待处理**，其余是 **已回归**、**已解决**、**已忽略** 和 **全部状态**）、**全部版本** 和 **全部环境** 筛选。

问题有以下状态之一。

| 状态 | 含义 |
| --- | --- |
| **待处理** | 新建或重新打开的，还需要处理。 |
| **已解决** | 你已经修复了它。在该行的菜单中点击 **标记解决**。 |
| **已忽略** | 你决定不处理它。点击 **忽略**。 |
| **已回归** | 一个已解决的问题再次发生。由 Flareboard 自己设置。 |

在该行的菜单中使用 **重新打开**、**标记解决** 或 **忽略** 来更改状态。问题页面还有最近一次发生的 **堆栈**、给团队用的 **评论**、**最近发生**，以及该问题的 **指纹**。

### 回归

当一个已解决的问题在你解决之后再次发生时，它会变成 **已回归**。问题页面保留一份 **回归记录**，包含它何时被解决、何时再次发生，以及是否发送了告警。Flareboard 会在新错误到达时、在问题列表加载时，以及在每小时一次的扫描中发现回归。

## 5. 用 source map 读取原始代码

浏览器上报的是压缩文件中的位置。source map 让 Flareboard 能显示你源码中的文件、行以及周围的代码。

1. 开启 source map 来构建你的应用。
2. 把 `data-release` 设为你要为之上传的版本，如 [第 1 步](#1-设置版本和环境) 所述。
3. 在该版本下上传每个 `.map` 文件，可以在控制台中上传，也可以从 CI 上传。

### 从控制台上传

1. 打开 **错误**，再打开 **Source map**。
2. 点击 **上传**。
3. 输入 **版本**（例如 `storefront@3.40.0`）、**文件路径**（例如 `assets/app.js.map`）和 **Source map JSON**，然后点击 **上传 source map**。

同一个面板会列出已上传的 map，按你在页面上选择的版本筛选，并让你可以删除它们。

### 从 CI 上传

在 **API 密钥** 下创建一个带 **写入** 权限的个人 API 密钥，然后以 `multipart/form-data` 发送 map 文件。每个部分的文件名就是 map 存储的路径，通常是脚本在你网站中的路径加上 `.map`。

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/errors/source-maps \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F release=YOUR_RELEASE \
  -F "file=@dist/assets/index-C3sPvF1q.js.map;filename=assets/index-C3sPvF1q.js.map"
```

返回 `201`，内容是版本和一个 `sourceMaps` 列表，其中有每个 map 的 `id`、`file`、`size` 和时间戳。重复 `-F "file=@...;filename=..."` 可上传更多 map，每个请求最多 100 个。自托管用户请把 `api.flareboard.dev` 换成自己的 API 地址。

| 规则 | 说明 |
| --- | --- |
| 格式 | JSON source map，版本 3。带 `sections` 的索引 map 会被拒绝，所以请每个文件上传一个 map。 |
| 大小 | 每个 map 最大 20 MB。 |
| 替换 | 再次上传相同的版本和文件会替换该 map。 |
| JSON 上传 | 也可以把 `{"release": "...", "file": "...", "content": "..."}` 以 JSON 形式 `POST`，content 最多 500 万个字符。返回 `201` 和该 map。 |
| 列出与删除 | `GET /api/websites/YOUR_WEBSITE_ID/errors/source-maps?release=YOUR_RELEASE`，以及 `DELETE /api/websites/YOUR_WEBSITE_ID/errors/source-maps/SOURCE_MAP_ID`。 |

### map 如何匹配

Flareboard 从每个堆栈帧中读取脚本路径（不含来源、查询字符串或片段的 URL），并查找该版本的 map。对于 `https://example.com/assets/index-C3sPvF1q.js`，它会依次查找以 `assets/index-C3sPvF1q.js.map`、`assets/index-C3sPvF1q.js`、`index-C3sPvF1q.js.map` 或 `index-C3sPvF1q.js` 存储的 map。没有版本的错误，在文件名带有内容哈希（这让匹配没有歧义）时，仍然可以匹配。

有 map 的帧会显示原始的文件、行和列，如果 map 包含 `sourcesContent`，还会显示周围的代码行。没有 map 的帧保持压缩状态。问题页面上最近一次发生，以及错误页面上的 **解析后的堆栈** 都会使用这些 map。

## 6. 接收告警

1. 打开 **错误**，再打开 **告警**。
2. 点击 **新建规则**，然后填写表单。
3. 点击 **创建告警规则**。

| 字段 | 作用 |
| --- | --- |
| **规则名称** | 规则的标签。 |
| **阈值** | 触发规则的错误数量，1 到 100,000。 |
| **窗口（分钟）** | 统计错误的时间段，1 到 10,080。 |
| **严重级别**、**版本**、**环境** | 可选的筛选。保持 **全部** 或 **任意**，则统计所有错误。 |
| **通道** | **仅记录** 只把告警存储在 Flareboard 中。**邮件** 和 **Webhook** 还会发出通知。 |
| **目标** | 邮箱地址或 webhook URL。 |
| **已解决的问题再次出现时也通知** | 当某个问题变为 **已回归**，且该次发生符合规则的严重级别、版本和环境筛选时，通过规则的邮件或 webhook 发送一条消息。 |

规则每小时检查一次。当它在最近一个窗口内发现至少达到阈值数量的匹配错误时就会触发，在经过完整的一个窗口之前不会再次触发。因此，窗口较短的规则可能会错过落在两次检查之间的突发。

Webhook 会收到一个 JSON `POST`。告警形如：

```json
{
  "type": "error_alert",
  "websiteId": "YOUR_WEBSITE_ID",
  "ruleName": "Checkout errors",
  "count": 42,
  "threshold": 20,
  "windowMinutes": 60
}
```

回归消息的 `"type"` 是 `"error_regression"`，并带有 `fingerprint`、`title`、`release`、`environment`、`occurredAt`、`resolvedAt` 和 `issueUrl`。当多条规则指向同一个目标时，该目标只会收到一条回归消息。

## 7. 跳转到会话回放

每次发生都属于一个会话。在 **错误** 页面中，打开一次发生记录或一个问题，点击 **查看会话**。如果 [会话回放](/docs/zh/session-replay) 录制了这次访问，会话页面会提供 **观看回放**，这次访问的错误也会出现在播放器的时间线上。反过来，回放列表有一个 **有错误的回放** 筛选。回放需要 Cloud 或 Business 套餐。

## 使用 API

所有路径都在 `https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID` 下。请发送 `Authorization: Bearer YOUR_API_KEY`。读取需要 **读取** 权限，写入需要 **写入** 权限。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/errors` | 总数、问题和最近的错误。筛选参数 `release`、`environment`、`status`（`open`、`resolved`、`ignored`、`regressed`），以及以 Unix 毫秒表示的 `startAt` 和 `endAt`（默认是最近 24 小时）。 |
| `GET` | `/errors/issues/FINGERPRINT` | 一个问题及其详情。 |
| `GET` | `/errors/EVENT_ID` | 一次发生记录。 |
| `PATCH` | `/errors/issues` | 设置问题的状态。请求体 `{"fingerprint":"...","status":"resolved"}`。还接受 `note` 和 `assigneeUserId`。 |
| `POST` | `/errors/issues/comments` | 添加评论。请求体 `{"fingerprint":"...","body":"..."}`。 |
| `POST` | `/errors/issues/merge` | 合并问题。请求体 `{"targetFingerprint":"...","sourceFingerprints":["..."]}`。 |
| `DELETE` | `/errors/issues/FINGERPRINT/merge` | 取消合并一个问题。 |
| `GET`、`POST` | `/errors/alerts` | 列出或创建告警规则。 |
| `PATCH`、`DELETE` | `/errors/alerts/ALERT_RULE_ID` | 修改或删除规则。 |

[MCP 服务](/docs/zh/mcp) 还有一个 `list_error_issues` 工具，返回错误总数和靠前的问题，AI 工具可以替你读取。

## 检查是否生效

1. 打开安装了脚本的网站。在浏览器控制台中运行 `flareboard.captureException(new Error('Flareboard test error'))`。
2. 在控制台中打开你的网站，再打开 **错误**。等几秒钟后刷新。
3. 问题 **Flareboard test error** 会出现在 **错误问题** 下，有 1 次发生。打开它。如果你已经为该版本上传了 source map，**堆栈** 会显示你的原始文件。
4. 要测试自动捕获，请运行 `setTimeout(() => { throw new Error('Uncaught test error') })`。它会作为第二个问题出现。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 什么也没有出现 | 脚本被拦截（广告拦截器，或拦截了 `t.flareboard.dev` 的 Content Security Policy），访客已退出，或日期范围或状态筛选把它隐藏了。默认的状态筛选是 **待处理**。 |
| 堆栈是压缩状态 | 没有匹配的 map。请检查页面的 `data-release` 是否与你上传的版本一致，并且上传的文件路径是脚本的路径（不含域名）加 `.map`，或其文件名加 `.map`。 |
| 上传失败并返回 `400` | 文件不是版本 3 的 source map，或它带有 `sections`，或缺少 `release`，或 `release` 超过 200 个字符。 |
| 上传失败并返回 `413` | map 超过 20 MB。 |
| 一个 bug 被拆成了多个问题 | 它的堆栈帧在不同次发生之间有差异，或者它没有堆栈而消息不同。请合并这些问题，或设置 `$exception_fingerprint`。 |
| 不相关的错误归到同一个问题 | 它们没有应用内堆栈，且消息相似。请设置自定义的 `$exception_fingerprint`。 |
| 告警从不触发 | 规则每小时检查一次。阈值必须在窗口内达到，并且严重级别、版本和环境筛选必须匹配。 |

## 下一步

- 用 [会话回放](/docs/zh/session-replay) 查看访客做了什么。
- 用 [日志与链路追踪](/docs/zh/logs-traces) 发送服务端日志和链路追踪。
- 用 [MCP 服务](/docs/zh/mcp) 向 AI 工具询问你的错误。
