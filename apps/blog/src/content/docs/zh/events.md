---
title: 追踪事件
description: 用 flareboard.track() 或 HTML 属性发送自定义事件，识别已登录的用户并为其分组，了解自动采集会记录什么。
---

页面浏览会被自动记录，其余一切由事件来记录：注册、购买、按钮点击、功能使用。你可以在 JavaScript 中用 `flareboard.track()` 发送事件，也可以不写 JavaScript，只用 HTML 属性。事件显示在该网站的 **事件** 下，也会出现在漏斗、留存和其他 [产品分析](/docs/zh/product-analytics) 视图中。

## 开始之前

页面上必须已经安装 [追踪脚本](/docs/zh/install/script) 或 [npm 包](/docs/zh/install/npm)。

## 在 JavaScript 中追踪事件

```js
flareboard.track('signup_completed', { plan: 'pro', source: 'pricing_page' });
```

| 参数 | 类型 | 作用 |
| --- | --- | --- |
| `name` | string | 事件名称，最长 50 个字符。必填。 |
| `data` | object | 可选的属性，扁平的键值对。见 [限制](#命名与属性限制)。 |
| `tag` | string | 可选的标签，最长 50 个字符，随事件一起存储。 |

脚本版本返回一个 promise，在请求结束时 resolve。它从不 reject：发送失败时，控制台会输出 `[flareboard] send failed`。你不需要等待它。

使用 npm 包时，调用方式相同：

```ts
import { flareboard } from '@flareboard/js';

flareboard.track('signup_completed', { plan: 'pro' });
```

### 在脚本加载前调用

脚本标签使用了 `defer`，所以调用 `flareboard.track()` 的内联 `<script>` 会运行得太早，并报错 `flareboard is not defined`。可以改为在事件处理函数里或页面加载完成后调用，使用会排队调用的 npm 包，或者把调用推入脚本启动时读取的队列：

```html
<script>
  window.flareboard = window.flareboard || { _q: [] };
  window.flareboard._q.push(['track', ['pricing_viewed', { plan: 'pro' }]]);
</script>
```

每个队列条目的格式是 `[methodName, [arguments]]`。排队的采集类调用（`track`、`page`、`revenue`、`log`、`ai`、`captureException`）在第一次页面浏览之后运行。

## 不用 JavaScript 追踪点击

给元素加上 `data-flareboard-event`。点击该元素或其内部的任何内容都会发送事件。属性来自 `data-flareboard-event-<name>` 属性，标签来自 `data-flareboard-event-tag`：

```html
<button data-flareboard-event="signup" data-flareboard-event-plan="pro" data-flareboard-event-tag="hero">
  Sign up
</button>
```

这会发送事件 `signup`，属性 `plan` 的值为 `pro`，标签为 `hero`。属性值始终是字符串，属性名是 `data-flareboard-event-` 之后的那部分。

Umami 的属性也同样有效：`data-umami-event`、`data-umami-event-<name>` 和 `data-umami-event-tag`。如果你从 Umami 迁移过来，现有的标记可以继续使用。

## 识别用户

默认情况下，访客是匿名的：按每月更换盐值的 IP 和 user agent 哈希来统计，不存储任何 ID。用户登录后调用 `identify`，把事件关联到你自己的用户 ID：

```js
flareboard.identify('user_123', { plan: 'pro' });
```

| 参数 | 类型 | 作用 |
| --- | --- | --- |
| `distinctId` | string | 你为该用户设定的稳定 ID。必填。空值不会产生任何效果。 |
| `properties` | object | 可选的用户属性，扁平的键值对。它们会保存在用户档案中，位于 **用户画像** 下。 |

调用 `identify` 之后：

- 该 ID 会被记在浏览器中（在 `localStorage` 里），并随之后的每个事件一起发送，直到你调用 `reset()`。你不需要在每个页面上再次调用 `identify`。
- 如果网站开启了 **跨会话识别访客**，此前的匿名行为会通过别名关联到该用户。

请使用在你的系统之外没有意义的内部 ID（例如数据库 ID）作为 distinct ID。不要发送密码、支付信息，或其他你不愿意存放在分析工具里的数据。

如果想自己关联两个 ID，使用 `flareboard.alias(alias, distinctId)`。见 [追踪器参考](/docs/zh/reference/tracker#javascript-api)。

### 退出登录时重置

用户退出登录时调用 `reset()`，这样同一浏览器上的下一个人就不会被归到他们名下：

```js
flareboard.reset();
```

`reset()` 会清除已识别的 ID、匿名 ID、会话和访问 ID，以及所有 [超级属性](#每个事件都带上的属性)。它不会清除退出追踪的设置。

### 分组

用 `group` 把用户归入某个账号、公司或团队：

```js
flareboard.group('company', 'acme', { name: 'Acme' });
```

参数依次是分组类型（最长 80 个字符）、分组键（最长 200 个字符）和可选的属性。缺少类型或键的调用不会产生任何效果。当访客有 ID 时（即调用 `identify` 之后，或开启了 **跨会话识别访客** 时），分组会关联到对应的用户。分组显示在控制台的 **账号组** 下。

## 每个事件都带上的属性

超级属性会随每个事件发送，直到你把它们移除。适合用于整个会话都适用的值，比如应用版本：

```js
flareboard.register({ app_version: '2.4.0' });
flareboard.registerOnce({ first_touch: 'ads' }); // 仅在尚未设置时写入
flareboard.unregister('app_version');
```

传给 `track` 的属性优先于同名的超级属性。一个事件总共最多带 100 个属性。超级属性保存在当前标签页中（在 `sessionStorage` 里），如果网站开启了访客记忆，则保存在 `localStorage` 中。

## 自动采集

自动采集无需写代码就能记录交互。它会为以下情况发送 `$autocapture` 事件：

- 点击链接、按钮、带有 `role="button"` 的元素，以及类型为 `submit` 或 `button` 的 `input` 元素；
- 表单提交；
- `input`、`select` 和 `textarea` 字段的变更。

自动采集从不发送访客输入或选择的内容，字段的值根本不会被读取。对每次交互，它只发送元素的信息：

| 属性 | 内容 |
| --- | --- |
| `$event_type` | `click`、`submit` 或 `change` |
| `$el_tag` | 元素的标签名 |
| `$el_id`、`$el_classes` | ID，以及最多 10 个类名 |
| `$el_type`、`$el_name` | input 和按钮的 `type`；字段和表单的 `name` |
| `$el_text` | 可见文本，最长 255 个字符。字段、密码或看起来敏感的元素，以及看起来像邮箱地址、银行卡号或类似数字的文本，一律不发送。 |
| `$el_href` | 链接的 `href`（最长 500 个字符；`javascript:` 链接不发送） |
| `$el_selector` | 该元素及其最多五层祖先元素，例如 `div.menu > a.nav-link` |

脚本遵循的规则：

- 密码字段和隐藏字段，以及属性看起来敏感的字段（例如名称或 ID 中含有 `otp`、`cvv`、`iban`、`token` 或 `secret`），在 `change` 事件中会被跳过。
- 带有 `data-fb-no-capture` 或类名 `ph-no-capture` 的元素，其内部的任何内容都不会被采集，它的文本也不会计入父元素的文本。
- 每个页面（页面加载或路由切换会重新开始计数）最多先突发发送 10 个，之后每秒补充一个，总共最多 100 个。同一个元素在一秒内再次被点击时，该事件会被丢弃。
- 默认开启，遵循网站设置 **自动采集点击、表单提交和页面离开**，位于 **设置** 的 **数据采集** 下。脚本标签上的 `data-autocapture="true"` 或 `"false"` 可以在该页面上覆盖这项设置。自动采集的事件会计入你的套餐额度。

访客离开页面时，自动采集还会发送带有停留时间和滚动深度的 `$pageleave` 事件。除非你设置了 `data-pageleave`，否则它跟随自动采集。

标出你想排除的元素：

```html
<div data-fb-no-capture>
  <button>Delete account</button>
</div>
```

## 命名与属性限制

事件名称请使用统一的风格，比如小写的 `object_action`（`invoice_paid`、`signup_completed`）。选定一种大小写格式并保持不变。名称写动作，而不是按钮。可变的部分放进属性，而不是名称里（用 `plan_selected` 加 `plan: 'pro'`，而不是 `plan_pro_selected`）。

不要让你自己的名称以 `$` 开头。Flareboard 把这个前缀用于自己的事件：`$autocapture`、`$pageleave`、`$alias` 和 `$feature_flag_called`。问卷组件发送的是 `survey_response`。

| 限制 | 值 |
| --- | --- |
| 事件名称 | 50 个字符。名称过长会导致整个请求以 HTTP 400 失败。 |
| 标签 | 50 个字符。 |
| 每个事件的属性数 | 100。超过时采集服务拒绝请求（HTTP 400）。脚本在合并超级属性时最多保留 100 个。 |
| 属性值类型 | 字符串、数字和布尔值会被存储。`null`、`undefined`、对象和数组会被丢弃。 |
| 字符串长度 | 超过 2,000 个字符的字符串值会被截断。 |
| 请求大小 | 每个请求 64 KB。 |
| 请求速率 | 每个 IP 地址和网站每分钟 100 个请求。超出时采集服务返回 HTTP 429。 |

## 相关调用

| 调用 | 用途 |
| --- | --- |
| `flareboard.revenue(amount, currency, { name, data })` | 随事件记录收入。在第三个参数中传入 `name`。币种默认为 `USD`。 |
| `flareboard.captureException(error, context)` | 发送一个已处理的错误。见 [错误追踪](/docs/zh/error-tracking)。 |
| `flareboard.log(level, message, data)` | 发送一行结构化日志。见 [日志与链路](/docs/zh/logs-traces)。 |
| `flareboard.ai(observation)` | 记录一次 LLM 调用。见 [LLM 分析](/docs/zh/llm-analytics)。 |
| `flareboard.optOut()` 和 `flareboard.optIn()` | 停止和恢复此浏览器上的所有追踪，例如通过同意横幅触发。 |

所有这些调用都列在 [追踪器参考](/docs/zh/reference/tracker#javascript-api) 中。来自服务器和不使用浏览器脚本的应用的事件，见 [服务端事件](/docs/zh/install/server)。

## 检查是否生效

1. 在你的网站上触发该事件。
2. 在浏览器开发者工具的 **Network** 标签中，找到对 `/api/send` 的 `POST`。它的请求负载包含 `"name":"your_event_name"`，你的属性在 `data` 下，响应状态为 200。
3. 在 Flareboard 中打开该网站的 **事件**，事件名称会出现在列表中。打开 **实时** 可以在几秒内看到它。

没有数据？见 [故障排查](/docs/zh/troubleshooting)。
