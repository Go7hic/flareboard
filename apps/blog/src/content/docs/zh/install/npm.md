---
title: 用 npm 安装
sidebarTitle: npm 包
description: 使用 @flareboard/js 包在代码中加载追踪器，借助 TypeScript 类型调用它，并使用 React hooks。
---

`@flareboard/js` 是 [追踪脚本](/docs/zh/install/script) 的一个带类型的小型加载器。它从你的采集地址注入 `script.js`，并把脚本加载完成之前的所有调用排入队列，所以你可以立刻调用 `flareboard.track()`。当你构建 JavaScript 应用，并希望用 import 和类型而不是 `<script>` 标签时，就使用它。

这个包不会取代脚本，它加载的是同一个 `script.js`，因此行为、隐私规则和数据完全相同。

## 开始之前

- 一个网站 ID。打开 **网站**，进入网站的 **设置**，从 **跟踪代码** 卡片中复制。
- 一个浏览器端应用。这个包可用于任何打包工具。它以 ES module 发布（`"type": "module"`），并自带 TypeScript 声明。

## 1. 安装

```bash
npm install @flareboard/js
```

`pnpm add @flareboard/js` 和 `yarn add @flareboard/js` 的效果相同。

## 2. 只初始化一次

尽早在浏览器中运行的代码里调用一次 `init`：

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev', // 你的采集地址
  websiteId: 'YOUR_WEBSITE_ID',
});

flareboard.track('signup_started', { plan: 'pro' });
```

- `init` 在浏览器之外什么也不做，所以在服务端渲染的应用中导入它是安全的。
- 第二次调用 `init` 会被忽略，并在控制台输出警告。
- `init` 需要 `host`，以及 `websiteId` 或 `projectKey` 之一。缺少时它会输出警告并且什么也不做。
- `host` 是采集地址。脚本从 `${host}/script.js` 加载。自托管用户使用自己的地址。

### 选项

| 选项 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `host` | string | 必填 | 采集地址。脚本从 `${host}/script.js` 加载。 |
| `websiteId` | string | 无 | 网站 UUID。`websiteId` 和 `projectKey` 必须提供其一。 |
| `projectKey` | string | 无 | 网站的项目密钥（`fb_pk_...`），由采集服务解析出对应的网站。设置了 `websiteId` 时被忽略。 |
| `autocapture` | boolean | 网站设置（开启） | 自动采集点击、表单提交和字段变更。字段的值永远不会被发送。 |
| `capturePageleave` | boolean | 与 `autocapture` 相同 | 发送带有停留时间和滚动深度的 `$pageleave` 事件。 |
| `persistence` | boolean | 网站设置 | `false` 表示在此页面上永不在 `localStorage` 中保留匿名访客 ID。开启持久化是网站层面的设置。 |
| `respectDnt` | boolean | 网站设置（关闭） | 开启了 Do Not Track 或 Global Privacy Control 的浏览器不发送任何数据。 |
| `release` | string | 无 | 用于错误、日志和功能开关定向的版本标签。 |
| `environment` | string | 无 | 用于错误、日志和功能开关定向的环境标签。 |
| `heatmapSampleRate` | 0 到 1 的数字 | 0.1 | 在网站设置加载完成之前，为热力图发送的点击和滚动的比例。 |
| `scriptUrl` | string | `${host}/script.js` | 从其他地址加载脚本。 |
| `nonce` | string | 无 | 注入的 `<script>` 标签使用的 CSP nonce。 |

大多数选项会变成注入的脚本标签上的 `data-*` 属性（`host`、`scriptUrl` 和 `nonce` 除外）。每个选项的作用见 [追踪器参考](/docs/zh/reference/tracker)。

## 3. 调用 API

方法与 `window.flareboard` 相同：

```ts
import { flareboard } from '@flareboard/js';

flareboard.track('checkout_started', { plan: 'pro' });
flareboard.identify('user_123', { plan: 'pro' });
flareboard.group('company', 'acme', { name: 'Acme' });
flareboard.reset(); // 退出登录时调用

flareboard.register({ app_version: '2.4.0' }); // 随每个事件发送

flareboard.captureException(new Error('Payment failed'), { severity: 'error' });
```

说明：

- 包的方法没有返回值（`void`），而脚本自身的方法返回 promise。直接调用包的方法，不要等待它。
- 脚本加载完成前，调用会被排入队列并按顺序重放。身份、超级属性和同意相关的调用（`identify`、`register`、`optOut` 等）会在第一次页面浏览之前运行，让页面浏览带上它们。采集类调用（`track`、`page`、`revenue`、`log`、`ai`、`captureException`）在它之后运行。
- 脚本加载完成前，`getDistinctId()` 返回 `''`，`getSessionId()` 和 `getVisitId()` 返回 `null`，功能开关的取值方法返回你给的兜底值（或脚本上次报告的开关）。需要真实值时，使用 `onFeatureFlags` 或 `featureFlagsReady()`。
- 脚本加载完成后 `flareboard.loaded` 为 `true`。`init` 在浏览器中运行过之后，`flareboard.initialized` 为 `true`。

这个包提供 [追踪器参考](/docs/zh/reference/tracker#javascript-api) 中列出的方法，但 `getFeatureFlagVariant` 和 `showSurvey` 除外，它们只存在于 `window.flareboard` 上。

## 用包或用脚本标签，不要同时用

二选一。只有当追踪器已经加载完成时，`init` 才会跳过注入脚本。它看不到仍在加载中的脚本标签，所以两者并用可能会加载两份，导致每次页面浏览被记录两次。

## React

`react` 18 或更高版本是可选的 peer 依赖。用 `FlareboardProvider` 包住你的应用：

```tsx
import { FlareboardProvider, useFeatureFlag, useFlareboard } from '@flareboard/js/react';

export function App() {
  return (
    <FlareboardProvider config={{ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' }}>
      <Checkout />
    </FlareboardProvider>
  );
}

function Checkout() {
  const flareboard = useFlareboard();
  const flow = useFeatureFlag('checkout.flow'); // 开关加载完成前或开关不存在时为 undefined

  if (flow === undefined) return null;
  return <button onClick={() => flareboard.track('checkout_clicked')}>{flow === 'new' ? 'Pay now' : 'Checkout'}</button>;
}
```

| 导出 | 作用 |
| --- | --- |
| `FlareboardProvider` | 在挂载后调用一次 `init(config)`，并把客户端提供给各个 hook。在服务端渲染期间使用是安全的。如果你自己调用 `init`，可以省略 `config`。 |
| `useFlareboard()` | 返回最近的 provider 提供的客户端（或共享客户端）。 |
| `useFeatureFlag(key, fallback?)` | 开关的值。开关加载完成或发生变化时会重新渲染。在开关加载完成之前、开关不存在时以及服务端渲染期间，返回 `fallback`（默认 `undefined`）。取值确定后会记录一次开关曝光。 |
| `useFeatureFlagPayload<T>(key)` | 附加在开关所分配变体上的 payload。 |

功能开关的内容见 [功能开关](/docs/zh/feature-flags)。

## TypeScript

类型随包一起发布。主要的几个：

```ts
import type {
  FlareboardConfig,
  FlareboardApi,
  FlareboardClient,
  Properties,
  FlagValue,
  LogLevel,
  AiObservation,
  ExceptionContext,
  FeatureFlagsCallback,
} from '@flareboard/js';
```

`Properties` 是 `Record<string, string | number | boolean | null | undefined>`。嵌套对象会被采集服务丢弃，所以事件属性请保持扁平。

如果你改用脚本标签，又想给 `window.flareboard` 加类型：

```ts
import type { FlareboardApi } from '@flareboard/js';

declare global {
  interface Window {
    flareboard?: FlareboardApi;
  }
}
```

## 其他导出

| 导出 | 作用 |
| --- | --- |
| `flareboard`（同时也是默认导出） | 共享客户端。 |
| `init(config)` | `flareboard.init(config)` 的简写。 |
| `createFlareboard(env?)` | 创建一个独立的客户端，主要用于测试。 |
| `scriptSrc(config)` | `init` 将要加载的脚本地址。 |
| `QUEUED_METHODS` | 在脚本加载前会被排队的方法名。 |

## 检查是否生效

1. 运行你的应用并在浏览器中打开。
2. 在开发者工具的 **Network** 标签中，找到来自你采集地址的 `script.js`（状态 200），以及对 `/api/send` 的一次 `POST`（状态 200）。
3. 在浏览器控制台中输入 `window.flareboard`。脚本加载完成后，它是一个带有 `track` 函数的对象。
4. 在 Flareboard 控制台中打开该网站的 **实时**。你的访问会在几秒内出现。

没有数据？见 [故障排查](/docs/zh/troubleshooting)。如果无法获取脚本，这个包会输出 `[flareboard] could not load ...`。

## 下一步

- [追踪事件](/docs/zh/events) 和 [识别用户](/docs/zh/events#识别用户)。
- 各框架的设置：[框架](/docs/zh/install/frameworks)。
- 全部选项和方法：[追踪器参考](/docs/zh/reference/tracker)。
