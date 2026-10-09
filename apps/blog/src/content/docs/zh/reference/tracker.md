---
title: 追踪脚本参考
description: 所有 script 标签属性、window.flareboard JavaScript API、追踪脚本发送的事件、它发出的请求，以及它在浏览器中存储的内容。
---

本页是关于 `script.js` 的事实参考。它是位于 `https://t.flareboard.dev/script.js` 的浏览器追踪脚本。安装方法见[安装追踪脚本](/docs/zh/install/script)。自托管用户请把地址换成自己的采集地址。

## Script 标签属性

所有属性都写在加载 `script.js` 的 `<script>` 标签上，除网站标识外都是可选的。属性缺省时，脚本遵循网站的设置。

| 属性 | 取值 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `data-website-id` | 网站 UUID | 无 | 接收数据的网站。除非设置了 `data-project-key`，否则必填。 |
| `data-project-key` | `fb_pk_...` 密钥 | 无 | 没有 `data-website-id` 时使用。脚本会请求 `/api/tracker-config?key=...`，并使用响应中的 `websiteId`。如果失败，它什么也不发送。 |
| `data-autocapture` | `true`、`false` | 网站设置（开启） | 除 `false` 外的任何值都视为开启。覆盖该页面的网站设置。 |
| `data-pageleave` | `true`、`false` | 与自动采集相同 | 除 `false` 外的任何值都视为开启。控制 `$pageleave` 事件。 |
| `data-persistence` | `false` | 网站设置（关闭） | 只有 `false` 有效：页面不会在 `localStorage` 中保存匿名 ID。 |
| `data-respect-dnt` | 存在，或 `false` | 网站设置（关闭） | 存在且值不是 `false` 时，表示不从启用了 Do Not Track 或 Global Privacy Control 的浏览器发送任何数据。`false` 会对该页面关闭网站设置。 |
| `data-environment` | 文本 | 无 | 作为 `environment` 随错误和日志发送，也用作功能开关定向中的 `environment`。 |
| `data-release` | 文本 | 无 | 作为 `release` 随错误和日志发送，也用作功能开关定向中的 `release`。 |
| `data-heatmap-sample-rate` | 0 到 1 的数字 | 0.1 | 为热力图发送的点击和滚动所占比例。取值会被限制在 0 到 1 之间。网站的热力图设置加载后会取代它。 |

用于[会话回放](/docs/zh/session-replay)的 `recorder.js` 标签会读取 `data-website-id` 和 `data-respect-dnt`。

### 页面元素上的属性

| 属性 | 使用者 | 作用 |
| --- | --- | --- |
| `data-flareboard-event` | 追踪脚本 | 点击该元素或其后代元素时，发送一个使用此名称的事件。 |
| `data-flareboard-event-<name>` | 追踪脚本 | 给该事件添加属性 `<name>`，值为该属性的值（字符串）。 |
| `data-flareboard-event-tag` | 追踪脚本 | 设置事件的标签。 |
| `data-umami-event`、`data-umami-event-<name>`、`data-umami-event-tag` | 追踪脚本 | 与 `data-flareboard-event` 系列属性相同，用于兼容 Umami 的标记。 |
| `data-fb-no-capture` 或类 `ph-no-capture` | 追踪脚本和录制器 | 自动采集会跳过该元素及其内部的所有内容。录制器不会录制它（会保留一个同样大小的占位块）。 |
| `data-fb-block`、类 `fb-block` 或 `ph-block` | 录制器 | 不录制该元素。 |
| `data-fb-mask`、类 `fb-mask` 或 `ph-mask` | 录制器 | 其中的文本和输入框会被遮罩。 |

## JavaScript API

脚本加载后，`window.flareboard` 就是 API（`window.Flareboard` 是同一个对象）。发送数据的方法会返回一个 promise，在请求结束时 resolve，且永远不会 reject。如果没有可发送的内容，例如没有网站 ID，方法会返回 `undefined`。[npm 包](/docs/zh/install/npm)封装了这些方法，并且不返回任何值。

### 事件和页面

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `track` | `name`、`data?`、`tag?` | Promise | 发送自定义事件。也会让触发事件与之相同的[问卷](/docs/zh/surveys)得以显示。参见[追踪事件](/docs/zh/events)。 |
| `page` | 无 | Promise | 为当前 URL 发送页面浏览；如果已开启，还会为上一个页面发送 `$pageleave`。SPA 的路由变化会自动完成这些。 |
| `revenue` | `amount`、`currency?`、`extra?` | Promise | 发送一个带有 `revenue` 和 `currency`（默认 `USD`）的事件。`extra` 可以包含 `name` 和 `data`。请传入 `name`。 |
| `captureException` | `error`、`extra?` | Promise | 发送一个 `handled: true` 的错误。`extra` 可以设置 `severity`、`handled`、`release`、`environment` 和 `data`。参见[错误追踪](/docs/zh/error-tracking)。 |
| `log` | `level`、`message`、`data?` | Promise | 发送一条日志。`level` 为 `trace`、`debug`、`info`、`warn`、`error` 或 `fatal`（默认 `info`）。参见[日志与链路追踪](/docs/zh/logs-traces)。 |
| `ai` | `observation` | Promise | 发送一条 LLM 观测数据。参见 [LLM 分析](/docs/zh/llm-analytics)。 |

### 身份

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `identify` | `distinctId`、`data?` | Promise | 保存该 ID（`localStorage` 和 `sessionStorage`），并随之后的每个事件发送。把 `data` 保存到该用户上。ID 为空时什么也不做。 |
| `alias` | `alias`、`distinctId?` | Promise | 发送一个 `$alias` 事件，把 `alias` 关联到 `distinctId`（默认是当前的 distinct ID）。 |
| `group` | `type`、`key`、`data?` | Promise | 把访客加入一个群组。缺少 type 或 key 时什么也不做。 |
| `reset` | 无 | 无 | 清除已识别的 ID、匿名 ID、会话和访问 ID、cache 令牌、功能开关曝光记录和 super properties。不会清除退出追踪的设置。 |
| `getDistinctId` | 无 | string | 已识别的 ID，否则是匿名 ID。当没有识别用户且不记住访客（网站设置关闭，或标签上有 `data-persistence="false"`）时为空。 |
| `getSessionId` | 无 | string 或 `null` | 最近一次被接受的请求返回的会话 ID。 |
| `getVisitId` | 无 | string 或 `null` | 最近一次被接受的请求返回的访问 ID。 |

### Super properties

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `register` | `properties` | 无 | 把这些属性合并到之后的每个事件中。 |
| `registerOnce` | `properties` | 无 | 与 `register` 类似，但会保留已经设置的值。 |
| `unregister` | `key` | 无 | 移除一个属性。 |

事件自身的属性优先于同名的 super properties。一个事件总共最多带 100 个属性。

### 同意与退出

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `optOut` | 无 | 无 | 停止所有发送和问卷。保存在 `localStorage` 的 `flareboard.opt_out` 中，因此跨访问持续有效。会话录制器也会停止。 |
| `optIn` | 无 | 无 | 清除退出状态。如果第一次页面浏览被暂缓，现在会发送。 |
| `hasOptedOut` | 无 | boolean | 调用 `optOut()` 之后为 `true`；或者出现 Do Not Track 或 Global Privacy Control 信号，且标签或网站设置遵循该信号时也为 `true`。 |

### 功能开关和问卷

| 方法 | 参数 | 返回值 | 说明 |
| --- | --- | --- | --- |
| `getFeatureFlag` | `key`、`fallback?` | string 或 boolean | 返回变体 key、`'control'`、没有变体的已启用开关对应的 `'test'`，或 `false`。未知的开关返回 `fallback`（默认 `false`）。每个开关在每次页面加载中只记录一次 `$feature_flag_called` 事件。 |
| `getFeatureFlagVariant` | `key`、`fallback?` | string 或 boolean | 与 `getFeatureFlag` 相同。 |
| `isFeatureEnabled` | `key`、`fallback?` | boolean | 当值既不是 `false` 也不是 `'control'` 时为 `true`。 |
| `getFeatureFlagPayload` | `key` | any | 该开关所分配变体的 payload，或 `undefined`。 |
| `onFeatureFlags` | `callback(flags, variants, payloads)` | function | 开关加载完成后调用回调，路由变化后会再次调用。返回一个用于移除该回调的函数。 |
| `featureFlagsReady` | 无 | Promise | 开关加载完成时 resolve。 |
| `showSurvey` | 无 | 无 | 立即显示一个符合条件的问卷。 |

参见[功能开关](/docs/zh/feature-flags)和[问卷](/docs/zh/surveys)。

### 脚本加载前的调用

在脚本运行之前设置 `window.flareboard = { _q: [[method, args], ...] }`，例如：

```html
<script>
  window.flareboard = window.flareboard || { _q: [] };
  window.flareboard._q.push(['track', ['pricing_viewed', { plan: 'pro' }]]);
</script>
```

脚本启动时会分两组重放这个队列。`track`、`page`、`revenue`、`log`、`ai`、`captureException` 和 `showSurvey` 在第一次页面浏览之后运行。其他所有方法（身份、super properties、同意、开关）在它之前运行，这样页面浏览就会带上它们。未知的方法名会被忽略。排队的 `optOut` 会阻止第一次页面浏览。npm 包会替你构建这个队列。

## 追踪脚本发送的事件

| 事件 | 触发时机 | 属性 |
| --- | --- | --- |
| 页面浏览（无名称） | 页面加载、路由变化、`page()` | 无 |
| `$pageleave` | `pagehide`，以及下一次路由变化之前；需要开启自动采集或 `data-pageleave` | `$time_on_page`（页面可见的秒数）、`$max_scroll_depth`（百分比） |
| `$autocapture` | 在符合条件的元素上发生点击、提交或 change，且已开启自动采集 | `$event_type`、`$el_tag`、`$el_id`、`$el_classes`、`$el_type`、`$el_name`、`$el_text`、`$el_href`、`$el_selector`。不会发送字段的值。参见[追踪事件](/docs/zh/events#自动采集)。 |
| `$alias` | 匿名活动之后调用 `identify()`，以及 `alias()` | `alias`、`distinctId` |
| `$feature_flag_called` | 第一次读取某个开关 | `$feature_flag`、`$feature_flag_response`、`$feature/<key>` |
| `survey_response` | 问卷被完成 | `surveyId` |
| 错误 | 未捕获的错误或未处理的 promise rejection，以及 `captureException()` | message、name、stack（最多 12,000 个字符）、source、line、column、`handled`、`severity` |
| 性能 | 每次页面加载一次，在页面隐藏时或 10 秒后发送 | `lcp`、`inp`、`cls`、`fcp`、`ttfb` |
| 热力图点击和滚动 | 按热力图采样率抽取的点击和滚动深度样本 | 点击的位置和视口，滚动的深度 |

以 `$` 开头的名称由 Flareboard 保留。

## 追踪脚本发出的请求

所有请求都发往脚本加载时所在的源。

| 请求 | 时机 | 请求体 |
| --- | --- | --- |
| `GET /api/tracker-config?website=ID`（或 `?key=KEY`） | 加载时；如果 `sessionStorage` 中有不到 60 秒的副本则不请求 | 无 |
| `POST /api/send` | 每次页面浏览、事件、identify、group、错误、日志、AI 观测、web vitals 和热力图样本 | 以 `text/plain` 发送的 JSON：`{"type": ..., "payload": {...}, "cache": ...}`。`type` 为 `event`、`identify`、`group`、`error`、`log`、`ai`、`performance` 或 `heatmap` 之一。 |
| `POST /api/feature-flags/evaluate` | 网站有需要服务端求值的开关时，在加载和路由变化时发送 | JSON |
| `POST /api/surveys/response` | 访客回答问卷时 | JSON |

`recorder.js` 另外会发出 `POST /api/record`，以及它自己的 `GET /api/tracker-config`。`text/plain` 内容类型可以避免 CORS 预检请求。一次访问的第一个请求不带 `cache` 值。响应中会返回一个，脚本把它保存在 `sessionStorage` 中，并随之后的请求发送。采集端允许每个 IP 地址和网站每分钟 100 个请求，请求体最大 64 KB。参见[采集 API 参考](/docs/zh/reference/ingest-api)。

## Do Not Track 与退出追踪

- 当 `navigator.doNotTrack`（或 `window.doNotTrack`、`navigator.msDoNotTrack`）为 `1` 或 `yes`，或者 `navigator.globalPrivacyControl` 为 `true` 时，浏览器就发出了 Do Not Track 信号。
- 标签上有 `data-respect-dnt` 时，脚本立即不再从这样的浏览器发送任何数据。
- 没有这个属性时，由网站设置决定。在脚本得知该设置之前，它会暂缓发送来自带信号浏览器的数据（最多 100 条）。如果该设置关闭或无法加载，就会发送。
- 调用过 `optOut()` 的访客在调用 `optIn()` 之前永远不会被追踪，无论是否有信号。

## 浏览器存储

脚本不设置 cookie。它使用以下键：

| 键 | 位置 | 内容 |
| --- | --- | --- |
| `flareboard.distinct_id` | `localStorage` 和 `sessionStorage` | 传给 `identify()` 的 ID。 |
| `flareboard.anon_id` | 当网站记住访客且 `data-persistence` 不是 `false` 时在 `localStorage`；否则在设置加载期间在 `sessionStorage` | 随机的匿名访客 ID。 |
| `flareboard.props` | 记住访客时在 `localStorage`，否则在 `sessionStorage` | JSON 格式的 super properties。 |
| `flareboard.opt_out` | `localStorage` | 调用 `optOut()` 后为 `1`。 |
| `flareboard.survey:<id>` | `localStorage` 和 `sessionStorage` | 该问卷最近一次显示的时间。 |
| `flareboard.cache` | `sessionStorage` | 采集端返回的会话令牌。 |
| `flareboard.sid`、`flareboard.vid` | `sessionStorage` | 会话 ID 和访问 ID。 |
| `flareboard.scroll:<path>` | `sessionStorage` | 每个路径上看到的最深滚动位置。 |
| `flareboard.hmCfg:<websiteId>` | `sessionStorage` | 网站的设置，缓存 60 秒。 |

如果浏览器阻止存储，脚本会在页面存续期间把这些值保存在内存中。

## npm 包

[`@flareboard/js`](/docs/zh/install/npm) 会注入这同一个脚本，并以带类型的形式暴露这些方法，`getFeatureFlagVariant` 和 `showSurvey` 除外。
