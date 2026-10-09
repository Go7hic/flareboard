---
title: 安装追踪脚本
sidebarTitle: 追踪脚本
description: 把 Flareboard 的 script 标签加到页面中，用 data 属性选择选项，并在 Content Security Policy 中放行它。
---

追踪脚本就是一个 `<script>` 标签。它记录页面浏览（包括单页应用的路由切换），还可以选择性地自动采集点击、错误、Web Vitals 和热力图采样。任何可以编辑 HTML 的网站都能使用。如果你用 JavaScript 框架构建，标签放在哪里见 [框架](/docs/zh/install/frameworks)，也可以使用 [npm 包](/docs/zh/install/npm)。

## 开始之前

- Flareboard 中的一个网站及其网站 ID。打开 **网站**，进入网站的 **设置**，**跟踪代码** 卡片会显示填好你 ID 的完整代码。如果还没有添加网站，见 [快速开始](/docs/zh/quickstart)。
- 示例使用 Flareboard Cloud（`https://t.flareboard.dev`）。如果你自托管，请把所有出现的该地址换成你自己的采集地址。

## 1. 添加标签

把下面的代码粘贴到每个页面的 `<head>` 中，并替换 `YOUR_WEBSITE_ID`：

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

- 使用 `defer`，脚本就不会阻塞渲染，标签会在页面解析完成后运行。
- 把它放在每个需要统计的页面上，或放进共享的布局或模板。
- 脚本把数据发送到它被加载的那个源，所以 `src` 地址同时也是采集地址。
- 脚本文件的响应头是 `Cache-Control: public, max-age=86400`，所以对脚本的更改最多可能要一天才会到达浏览器。

## 2. 选择选项（可选）

选项是同一个标签上的 `data-*` 属性，全部可选。没有设置某个属性时，脚本遵循网站 **设置** 中 **数据采集** 下的网站设置。

```html
<script defer src="https://t.flareboard.dev/script.js"
  data-website-id="YOUR_WEBSITE_ID"
  data-environment="production"
  data-release="1.4.2"
  data-autocapture="false"
  data-persistence="false"
  data-respect-dnt></script>
```

| 属性 | 取值 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `data-website-id` | 网站 UUID | 无 | 哪个网站接收数据。除非使用 `data-project-key`，否则必填。 |
| `data-project-key` | 以 `fb_pk_` 开头的项目密钥 | 无 | 代替 `data-website-id` 使用。脚本根据密钥解析出网站。密钥在网站 **设置** 中显示为 **项目 API 密钥**。 |
| `data-autocapture` | `true`、`false` | 网站设置（开启） | 为带有此标签的页面开启或关闭点击、表单提交和字段变更的自动采集。 |
| `data-pageleave` | `true`、`false` | 与自动采集相同 | 发送带有停留时间和滚动深度的 `$pageleave` 事件。 |
| `data-persistence` | `false` | 网站设置（关闭） | `false` 表示在此页面上永不在 `localStorage` 中保留匿名访客 ID，即使网站已开启 **跨会话识别访客**。在访客同意之前可以使用它。 |
| `data-respect-dnt` | 存在，或 `false` | 网站设置（关闭） | 存在时，开启了 Do Not Track 或 Global Privacy Control 的浏览器不会发送任何数据。`data-respect-dnt="false"` 则在此页面上关闭该行为。 |
| `data-environment` | 任意文本 | 无 | 形如 `production` 的标签。附加在错误和日志上，也可用于功能开关的定向。 |
| `data-release` | 任意文本 | 无 | 形如 `1.4.2` 的版本标签。附加在错误和日志上，也可用于功能开关的定向。 |
| `data-heatmap-sample-rate` | 0 到 1 的数字 | 0.1 | 为热力图发送的点击和滚动的比例。在网站的热力图设置加载完成之前使用，加载后以网站设置为准。 |

`data-fb-no-capture` 加在页面元素上，而不是脚本标签上。自动采集会跳过该元素及其内部的所有内容。类名 `ph-no-capture` 的作用相同。见 [追踪事件](/docs/zh/events#自动采集)。

声明式事件属性（`data-flareboard-event` 及其属性）同样加在页面元素上。见 [追踪事件](/docs/zh/events#不用-javascript-追踪点击)。

每个属性的完整说明见 [追踪器参考](/docs/zh/reference/tracker)。

## 脚本会采集什么

默认情况下，脚本会记录：

- 页面加载时和每次客户端路由切换时的一次页面浏览。
- 自动采集开启时的 `$pageleave` 和 `$autocapture` 事件。输入的内容永远不会被发送。
- JavaScript 错误（`window` 错误和未处理的 promise 拒绝），供 [错误追踪](/docs/zh/error-tracking) 使用。
- Web Vitals（LCP、INP、CLS、FCP 和 TTFB），每次页面加载一次。
- 供 [热力图](/docs/zh/heatmaps) 使用的点击和滚动深度采样。
- 为该网站配置的功能开关和问卷。见 [功能开关](/docs/zh/feature-flags) 和 [问卷反馈](/docs/zh/surveys)。

脚本不设置 Cookie。它在 `sessionStorage` 中保存一个会话令牌和少量设置，在 `localStorage` 中保存退出标记和已识别的用户 ID。完整清单见 [追踪器参考](/docs/zh/reference/tracker#浏览器存储)。

## 单页应用

路由切换不需要你调用任何东西。脚本会监听 `history.pushState`、`history.replaceState`、`popstate` 和 `hashchange`，页面变化时记录一次新的页面浏览。以下情况会被视为新页面：

- 路径不同，或查询字符串不同。
- hash 路由不同，例如 `#/settings`。以 `#/` 开头的 hash 会被当作页面路径。

页内锚点（如 `#pricing`）不会被当作新页面。想自己记录一次页面浏览，请调用 `flareboard.page()`。

## Content Security Policy

如果你的网站发送 `Content-Security-Policy` 响应头，请在脚本和连接两方面放行采集地址：

```text
Content-Security-Policy: script-src 'self' https://t.flareboard.dev; connect-src 'self' https://t.flareboard.dev
```

- `script-src` 让浏览器可以加载 `script.js`。
- `connect-src` 让脚本可以用 `fetch` 和 `navigator.sendBeacon` 发送事件，并读取 `/api/tracker-config`。
- 如果你的策略使用 nonce，请在标签上加上你的 `nonce` 属性。使用 npm 包时，传入 `nonce` 选项。
- 使用 [会话回放](/docs/zh/session-replay) 时，还要在 `script-src` 中放行 `https://cdn.jsdelivr.net`，因为 rrweb 库从那里加载。

## 会话回放

要录制会话，需要再加两个脚本：rrweb 库和 `https://t.flareboard.dev/recorder.js`，后者需要相同的 `data-website-id`。还必须在网站 **设置** 中开启回放，在 Flareboard Cloud 上还需要 Cloud 或 Business 套餐。完整代码和隐私选项见 [会话回放](/docs/zh/session-replay)。

## 检查是否生效

1. 打开你的网站并刷新一个页面。
2. 在浏览器开发者工具中打开 **Network** 标签，筛选 `script.js`。它应该以状态 200 加载。
3. 筛选 `send`。对 `https://t.flareboard.dev/api/send` 的 `POST` 请求应返回状态 200，并带有包含 `cache`、`sessionId` 和 `visitId` 的 JSON。
4. 在 Flareboard 控制台中打开 **网站**，进入网站的 **设置**，点击 **测试连接**。显示 **已连接**，并带有 **最近事件时间** 和一个时间，说明已经生效。

如果缺少某项，见 [故障排查](/docs/zh/troubleshooting)。

## 下一步

- [追踪事件](/docs/zh/events)，例如注册和购买。
- 登录后 [识别用户](/docs/zh/events#识别用户)。
- 在 [追踪器参考](/docs/zh/reference/tracker) 中查阅每个选项和方法。
