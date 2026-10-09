---
title: 故障排查
description: 排查 Flareboard 收不到数据、事件或页面缺失的原因，并学会查看追踪脚本发出的网络请求。
---

先看浏览器的网络请求。一分钟内就能看出脚本有没有加载、有没有发送数据，以及采集端返回了什么。下面按建议的检查顺序列出常见原因。

## 查看网络请求

1. 在浏览器中打开你的站点，并打开开发者工具。
2. 打开 **Network** 标签页并刷新页面。先过滤 `script.js`，再过滤 `send`。
3. 把看到的内容与下表对照。Flareboard Cloud 的采集地址是 `https://t.flareboard.dev`，自托管则是你自己的地址。

| 请求 | 预期 | 含义 |
| --- | --- | --- |
| `GET /script.js` | 状态 200，JavaScript | 追踪脚本已加载。 |
| `GET /api/tracker-config?website=YOUR_WEBSITE_ID` | 状态 200，JSON | 网站设置已加载。脚本会把它在 `sessionStorage` 中缓存 60 秒，所以快速刷新时可能看不到这个请求。 |
| `POST /api/send` | 状态 200，JSON 中包含 `cache`、`sessionId` 和 `visitId` | 页面浏览或事件已被接受。 |

`POST /api/send` 的请求体是以 `text/plain` 发送的 JSON，形如 `{"type":"event","payload":{"website":"...","url":"/pricing",...}}`。事件会在 payload 中多出 `"name"` 和 `"data"`。

`POST /api/send` 的状态含义：

| 响应 | 原因 | 解决方法 |
| --- | --- | --- |
| 200，返回 `{"cache":...}` | 已接受。 | 无需处理。如果控制台仍然没有数据，请检查你查看的是不是同一个网站。 |
| 200，返回 `{"beep":"boop"}` | 请求的 user agent 看起来像机器人或爬虫，因此被忽略。 | 用正常的浏览器测试。参见[机器人流量会被忽略](#机器人流量会被忽略)。 |
| 400，返回 `Website not found.` | 网站 ID 不存在，或该网站已被删除。 | 从该网站的**设置**中重新复制 ID。 |
| 400，返回其他信息 | 载荷未通过校验：网站 ID 无效、事件名称超过 50 个字符、属性超过 100 个，或请求体超过 64 KB。 | 阅读响应中的 `message`，修正调用。 |
| 402 | 在 Flareboard Cloud 上，账户的每月事件额度已用完（`Monthly event limit exceeded.`）。 | 参见[套餐与限额](/docs/zh/plans-limits)。 |
| 429 | 同一个 IP 地址对同一个网站每分钟请求超过 100 次。 | 降低发送频率。 |

浏览器控制台也有帮助。脚本会输出以 `[flareboard]` 开头的警告：

- `[flareboard] missing data-website-id`：标签中没有网站 ID。
- `[flareboard] send failed`：请求失败或返回了错误状态（例如 `Error: send 400`）。响应内容在 Network 标签页中。
- `[flareboard] could not resolve data-project-key`：项目密钥未知。

在浏览器控制台中输入 `window.flareboard`，应当得到一个对象。`undefined` 表示脚本没有加载或没有运行。

## 收不到数据

### 没有请求 `script.js`，或请求被拦截

- **页面中缺少标签。** 查看页面源代码，找 `src` 以 `/script.js` 结尾的 `<script>` 标签。确认它出现在你打开的页面渲染后的 HTML 里，而不只是在模板中。
- **广告拦截器或隐私扩展拦截了它。** 在 Network 标签页中请求显示为被拦截或失败，且 `window.flareboard` 是 undefined。在你自己的站点上关闭拦截器来确认。装有拦截器的访客不会被统计。脚本会把事件发送到它加载时所在的地址，所以从你自己的域名提供脚本，会改变拦截器看到的地址。这需要你自己把 `/script.js` 和脚本调用的 `/api/*` 路径（`/api/send`、`/api/tracker-config`、`/api/feature-flags/evaluate`、`/api/surveys/response`，以及回放使用的 `/api/record`）转发到采集 Worker。
- **内容安全策略（CSP）拦截了它。** 控制台会提示脚本或连接被策略拒绝。请在 `script-src` 和 `connect-src` 中允许采集地址。参见[内容安全策略](/docs/zh/install/script)。
- **地址写错。** `src` 必须是 Cloud 上的 `https://t.flareboard.dev/script.js`，或你自己的采集地址。

### 脚本已加载但什么也没发送

- **Do Not Track 或 Global Privacy Control。** 如果网站开启了**遵循 Do Not Track 与 Global Privacy Control**，或标签上有 `data-respect-dnt`，那么发送其中任一信号的浏览器不会发送任何数据。浏览器和隐私扩展都可能发送这两种信号。这种情况下，在浏览器控制台中 `flareboard.hasOptedOut()` 会返回 `true`。请在没有该信号的窗口中测试，或在**设置**的**数据采集**下关闭该选项。标签上的 `data-respect-dnt="false"` 可以对单个页面关闭它。
- **访客已退出追踪。** 如果你的代码或同意横幅在该浏览器中调用了 `flareboard.optOut()`，那么在调用 `flareboard.optIn()` 之前不会发送任何数据。这个选择保存在 `localStorage` 的 `flareboard.opt_out` 中。
- **网站 ID 错误或缺失。** 控制台会警告 `missing data-website-id`。ID 错误会让 `POST /api/send` 返回 400。
- **项目密钥无法解析。** 使用 `data-project-key` 时，脚本会先请求 `/api/tracker-config?key=...`。如果失败，它就什么也不发送，并输出 `could not resolve data-project-key`。

### 请求已发送但控制台没有数据

- **看错了网站。** 确认标签中的网站 ID 就是你正在查看的那个网站。
- **机器人 user agent。** 返回 `200` 和 `{"beep":"boop"}` 表示请求被忽略。参见[机器人流量会被忽略](#机器人流量会被忽略)。
- **日期范围。** 检查控制台中选择的范围。**实时**显示最近几分钟的数据。
- **速率限制或套餐限制。** 看上面是否有 402 或 429 状态。

在该网站的**设置**中，**跟踪代码**下的**测试连接**可以从 Flareboard 一侧做检查。显示**已连接**，并带有**最近事件时间**和一个时间，表示最近 15 分钟内有事件到达。显示 **无法从采集地址加载 tracker 脚本。** 表示脚本地址无法访问。

### 域名不一致

Flareboard 不会拿页面的主机名与你添加网站时填写的**域名**做比较。任何发送了有效网站 ID 的页面，不管域名是什么，都会记到该网站下。域名不一致不是数据缺失的原因。每个事件都会保存主机名。

### localhost 与开发环境

追踪脚本和采集 Worker 都不会对 `localhost` 或其他主机区别对待。你开发机器上的访问会像真实访问一样被记录，主机名为 `localhost`，并计入你的套餐额度。要让它们不混入真实数据，请为开发环境单独添加一个网站，并在开发环境中使用它的 ID。`data-environment` 是用于错误、日志和功能开关定向的标签，不会过滤页面浏览。

### 机器人流量会被忽略

采集端会检查每个请求的 `User-Agent` 请求头，并忽略来自爬虫和其他自动化浏览器的流量。它会返回 `200` 和 `{"beep":"boop"}`，且不记录任何内容。`curl`、`node`、`python-requests` 等 HTTP 库不会被当作机器人，所以可以用于服务端发送和测试。

## 事件缺失

- **事件名称超过 50 个字符。** 整个请求会以 400 失败。请缩短名称。
- **属性超过 100 个。** 请求会以 400 失败。请发送更少的属性。
- **嵌套属性丢失了。** `data` 中的对象和数组会被丢弃，只保存字符串、数字和布尔值。请把它们展平：用 `{ plan: 'pro' }`，不要用 `{ account: { plan: 'pro' } }`。
- **调用发生在脚本加载之前。** 使用 script 标签时，内联的 `flareboard.track()` 调用会在 defer 脚本之前执行，并因 `flareboard is not defined` 而失败。请使用 npm 包、在加载完成后调用，或者推入队列。参见[追踪事件](/docs/zh/events)。
- **自动采集的事件缺失。** 检查**自动采集点击、表单提交和页面离开**是否已开启，标签上是否没有 `data-autocapture="false"`，以及元素是否不在 `data-fb-no-capture` 内部。自动采集会丢弃 1 秒内同一元素的重复事件，并限制每个页面一次突发最多 10 个、总共最多 100 个。
- **点击声明式事件没有反应。** 属性必须是 `data-flareboard-event`（或 `data-umami-event`），且位于被点击元素本身或它的祖先元素上。
- **登录归因不对。** `identify` 之前的事件是匿名的。登录后请调用 `flareboard.identify()`，退出登录后请调用 `flareboard.reset()`。参见[识别用户](/docs/zh/events#识别用户)。

## 单页应用的页面没有被统计

当 History API 或 hash 变化时，脚本会记录一次新的页面浏览：包括 `pushState`、`replaceState`、`popstate` 和 `hashchange`。

- **只改变页内锚点的路由变化**，例如 `#pricing`，不算新页面。以 `#/` 开头的 hash 路由会被统计。
- **`replaceState` 到相同的地址**不算新页面。只改变查询字符串则算。
- **路由器没有使用 History API 或 hash 路由。** 每次导航后调用 `flareboard.page()`。
- **标题是旧的。** 脚本在路由变化的那一刻读取 `document.title`。如果你的框架稍后才更新标题，页面浏览会带上上一个标题。
- **脚本只在部分页面加载。** 如果站点同时包含服务端渲染的页面和应用，请确保标签出现在每个布局中。

## 页面浏览重复

追踪脚本被加载两次时，每个页面浏览都会翻倍。常见原因是同时使用了 script 标签和 npm 包（参见[用 npm 安装](/docs/zh/install/npm)），或者标签同时放在了布局和页面中。在 Network 标签页中查找是否有两个 `script.js` 请求。

## 用命令行测试

下面的命令在终端中发送一次页面浏览，并显示采集端的响应。请替换 `YOUR_WEBSITE_ID`：

```bash
curl -i -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{"type":"event","payload":{"website":"YOUR_WEBSITE_ID","hostname":"example.com","url":"/curl-test","title":"curl test"}}'
```

正常的配置会返回 `HTTP/2 200`，响应体形如 `{"cache":"...","sessionId":"...","visitId":"..."}`。这次访问随后会出现在**实时**中，并算作你套餐中的一个事件。如果返回 `400`，响应体会说明 ID 或载荷哪里有问题。

## 仍然无法解决

请发邮件到 [support@flareboard.dev](mailto:support@flareboard.dev)，附上网站 ID、页面地址，以及 `POST /api/send` 请求的状态和响应体。也可以在 [GitHub](https://github.com/Go7hic/flareboard/issues) 上提交 issue。
