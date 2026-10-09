---
title: 功能开关
description: 只对一部分访客开启某个功能，提供带负载的变体，并在浏览器或服务端读取开关。每次读取都会被记录为一次曝光。
---

功能开关让你先发布代码，但保持隐藏，直到你把它打开，可以对所有人开启，也可以只对一部分访客开启。Flareboard 为每位访客计算每个开关，把结果交给你的代码，并在你的代码读取开关时记录一个曝光事件。曝光就是 [实验](/docs/zh/experiments) 所衡量的对象。

## 开始之前

- **套餐：** 功能开关和实验需要 Cloud 或 Business 套餐。在 Free 套餐上，API 会返回 `403` 和“Feature flags require a paid plan.”。自托管安装拥有全部功能，没有套餐限制。
- **角色：** 你需要一个可以编辑该网站的账号。只有查看权限的账号可以打开页面并阅读开关，但编辑控件是禁用的。
- **追踪脚本：** 要在浏览器中读取开关，请先安装 [追踪脚本](/docs/zh/install/script) 或 [npm 包](/docs/zh/install/npm)。

## 1. 创建开关

1. 打开你的网站，然后在侧边栏中打开 **功能开关**。
2. 点击 **创建开关**。
3. 填写表单（下表解释了每一项），然后点击 **创建开关**。

新开关一保存就会生效，所以请从小比例放量开始。

| 设置 | 作用 |
| --- | --- |
| **名称** | 显示名称。必填，最长 120 个字符。 |
| **开关键** | 你的代码使用的字符串，例如 `checkout.new_flow`。以字母开头，后面是字母、数字、`.`、`:`、`_` 或 `-`。最长 80 个字符，在每个网站内唯一。 |
| **描述** | 谁应该看到这个功能以及原因。最长 500 个字符。 |
| **发布条件** | 谁能获得这个开关。见 [发布条件](#发布条件)。 |
| **变体** | 可选的命名值，用于多变体开关。见 [变体](#变体)。 |
| **负载（JSON）** | 随开关一起返回的可选 JSON。见 [负载](#负载)。 |
| **抢先体验功能** | 让用户自己选择加入或退出。见 [抢先体验](#抢先体验)。 |

### 发布条件

一个开关有一个或多个 **条件组**。Flareboard 按顺序检查这些组，第一个与访客匹配、且其放量范围包含该访客的组，决定开关的结果。

- 组内所有条件必须同时匹配（且）。
- 没有通过第一个组，或落在其放量范围之外的访客，仍然可以匹配后面的组（或）。
- 没有任何条件的组匹配所有人。
- **灰度给** 设置匹配的人中有多大百分比获得该开关，从 0 到 100。对于给定的开关键，同一位访客总是落在同一个位置。
- 一个开关最多允许 20 个组，每组最多 12 个条件。点击 **添加条件组** 或 **添加条件** 可添加更多。

每个条件包含字段、运算符和值。

| 字段 | 匹配对象 |
| --- | --- |
| **用户属性** | 存储在用户上的属性，由 `identify()` 设置。需要属性键。 |
| **事件属性** | 随请求发送的属性。需要属性键。追踪脚本不会发送任何事件属性，所以请配合服务端评估使用。 |
| **用户队列** | 属于该网站某个队列的成员资格。使用 **属于** 或 **不属于**。 |
| **分组**、**分组属性** | 用户所属的分组（需要分组类型），或分组的某个属性。 |
| **路径**、**URL**、**主机名**、**来源**、**语言**、**User agent** | 当前页面和浏览器。 |
| **Distinct ID**、**用户 ID** | 已识别的用户。 |
| **环境**、**版本** | 追踪脚本的 `data-environment` 和 `data-release` 的值。 |

其他字段的运算符：**等于**、**不等于**、**包含**、**不包含**、**开头是**、**结尾是**、**大于**、**大于等于**、**小于**、**小于等于**、**已设置**、**未设置**。文本比较不区分大小写。数字比较要求两边都是数字。

### 变体

没有变体时，开关只有开和关两种状态。要在多个值之间分配用户，请点击 **添加变体**，并为每个变体提供：

- 一个 **变体键**（字符规则与开关键相同）和一个 **名称**；
- 一个权重，0 到 100 的整数。

一个开关最多允许 8 个变体，权重之和不能超过 100。权重剩下的部分按 `control` 返回。落在放量范围之外的访客也得到 `control`。

对于某个条件组，你可以在 **指定变体** 下选择一个变体，而不是使用加权分配。这样该组中所有匹配的访客都会得到同一个变体。

### 负载

负载是任意 JSON 值，最大 16 KB，与开关一起返回。没有变体的开关有一个 **负载（JSON）**。有变体的开关为每个变体各有一个 **变体负载（JSON）**。负载会原样到达浏览器和 SDK，所以千万不要在其中放密钥。

### 抢先体验

勾选 **抢先体验功能**，并填写对外的 **公开名称** 和 **公开描述**。之后用户可以自己选择加入或退出。加入后，无论条件如何，该开关都会对此人开启；退出则保持关闭。参与状态存储在用户属性 `$feature_enrollment/FLAG_KEY` 中。对于开启了抢先体验的开关，可以用下面这样的请求记录某人的选择（密钥需要 **写入** 权限）：

```bash
curl -X PUT https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags/early-access/YOUR_FLAG_KEY/enrollment \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"distinctId":"user_123","enrolled":true}'
```

### 用 API 创建或修改开关

控制台使用同样的端点。创建一个对 10% 访客开启的开关：

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"checkout.new_flow","name":"New checkout flow","conditionGroups":[{"conditions":[],"rollout":10}]}'
```

返回 `201`，内容是该开关，包含它的 `id`。之后可以用 `PATCH /api/websites/YOUR_WEBSITE_ID/feature-flags/FLAG_ID` 修改它（例如 `{"enabled":false}`）。请在控制台的 **API 密钥** 下创建一个带 **写入** 权限的个人 API 密钥。自托管用户请把 `api.flareboard.dev` 换成自己的 API 地址。其他开关端点见 [REST API](/docs/zh/api)。

## 2. 在浏览器中读取开关

开关通过追踪器 API 在页面上可用。使用 script 标签时调用 `window.flareboard`；使用 npm 包时从 `@flareboard/js` 导入 `flareboard`。

| 方法 | 返回值 |
| --- | --- |
| `getFeatureFlag(key, fallback?)` | 变体键；没有变体且已开启的开关返回 `'test'`；访客未被分配该开关时返回 `'control'`；开关未知时返回 `fallback`（默认 `false`）。会记录一次曝光。 |
| `isFeatureEnabled(key, fallback?)` | 除非值为 `false` 或 `'control'`，否则返回 `true`。会记录一次曝光。 |
| `getFeatureFlagPayload(key)` | 该访客所属变体的负载，或 `undefined`。不记录曝光。 |
| `onFeatureFlags(callback)` | 如果开关已加载，立即调用 `callback(enabledKeys, variants, payloads)`，之后每次评估时再次调用。返回一个用于移除该回调的函数。不记录曝光。 |
| `featureFlagsReady()` | 一个 promise，在开关加载完成后 resolve。 |

脚本还提供 `getFeatureFlagVariant(key, fallback?)`，它是 `getFeatureFlag` 的别名。

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev',
  websiteId: 'YOUR_WEBSITE_ID',
});

await flareboard.featureFlagsReady();

if (flareboard.isFeatureEnabled('checkout.new_flow')) {
  showNewCheckout(flareboard.getFeatureFlagPayload('checkout.new_flow'));
}

const variant = flareboard.getFeatureFlag('pricing.layout'); // 'wide', 'compact' or 'control'
```

使用 React 时，用 `FlareboardProvider` 包住你的应用，并用 `@flareboard/js/react` 中的 `useFeatureFlag(key)` 和 `useFeatureFlagPayload(key)` 读取开关。`useFeatureFlag` 在开关加载完成前返回 `undefined`，并在值确定后记录曝光。设置方法见 [npm 包](/docs/zh/install/npm)。

### 开关何时加载

1. 脚本从 `https://t.flareboard.dev/api/tracker-config?website=YOUR_WEBSITE_ID` 获取网站的开关。它把结果在 `sessionStorage` 中保留 60 秒，响应本身也可以缓存 60 秒，所以你在控制台中所做的更改会在一到两分钟内到达访客。
2. 只会发送已启用的开关。已停用或已删除的开关与未知开关表现相同，所以读取它会返回你的 `fallback`（或 `false`），且不记录曝光。
3. 使用条件、多个条件组、**指定变体** 或抢先体验的开关在服务端评估。开关列表到达后，脚本会把页面、浏览器和身份信息 POST 到 `POST /api/feature-flags/evaluate`。条件本身永远不会离开服务端。
4. 然后脚本调用每一个 `onFeatureFlags` 回调，并 resolve `featureFlagsReady()`。
5. 每次客户端路由切换后，需要服务端评估的开关会针对新页面重新评估，回调也会再次运行。

在第 4 步之前读取开关会得到 fallback。开关列表已到达但服务端还没有回应时，需要服务端评估的开关读到的是 `'control'`。在你的界面中，请等待 `featureFlagsReady()`，或者在 `onFeatureFlags` 回调中渲染，在此之前什么都不显示（或显示旧的体验）。路由切换之后，在新的结果到达之前，服务端评估的开关读到的是 `'control'`，所以这里也请使用回调。

### 谁得到哪个变体

脚本和服务端会给同一个人分配相同的变体。分配依赖于访客的一个稳定 ID：

1. 你传给 `identify()` 的 ID；
2. 否则是一个随机的匿名 ID，但仅当网站开启了 **跨会话识别访客** 时；
3. 否则是会话 ID，所以匿名访客在之后的访问中可能得到不同的变体。

如果你需要让访客始终得到同一个变体，请在登录后调用 [identify()](/docs/zh/events#识别用户)。

## 3. 在服务端读取开关

根据你已经在运行的环境，选择下面之一。

| 方式 | 适用情况 | 凭证 |
| --- | --- | --- |
| PostHog SDK | 你已经在使用 `posthog-node` 或 `posthog-python`。 | 项目 API 密钥 |
| 采集服务上的 `POST /api/feature-flags/evaluate` | 你想用纯 HTTP，不用 SDK。 | 网站 ID 或项目 API 密钥 |
| API 上的 `POST /api/websites/WEBSITE_ID/feature-flags/evaluate-all` | 你想获取某个用户的全部开关，并看到每个开关的原因。 | 带 **写入** 权限的个人 API 密钥 |

### PostHog SDK

把 SDK 指向你的采集地址，并使用网站的 **项目 API 密钥**。它在网站的 **设置** 中。完整设置见 [PostHog SDK](/docs/zh/install/posthog)。

```ts
import { PostHog } from 'posthog-node';

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' });

const variant = await posthog.getFeatureFlag('checkout.new_flow', 'user_123');
const enabled = await posthog.isFeatureEnabled('checkout.new_flow', 'user_123');
await posthog.shutdown();
```

开关通过 `/flags` 在 Flareboard 的服务器上评估。不支持本地评估（个人 API 密钥加 `/api/feature_flag/local_evaluation`）。没有变体的开关返回 `true` 或 `false`，有变体的开关返回变体键。与该用户不匹配的开关返回 `false`，已停用的开关不会出现在响应中。负载在同一个响应中返回。

`/flags` 端点读取 `distinct_id`、`groups` 和 `person_properties`。你在 `person_properties` 中发送的属性由 **事件属性** 条件匹配。**用户属性** 条件使用 Flareboard 为该 distinct ID 存储的属性，所以请先识别这个人。

### 在采集服务上使用纯 HTTP

```bash
curl -X POST https://t.flareboard.dev/api/feature-flags/evaluate \
  -H "Content-Type: application/json" \
  -d '{"website":"YOUR_WEBSITE_ID","keys":["checkout.new_flow"],"context":{"distinctId":"user_123"}}'
```

```json
{ "results": { "checkout.new_flow": "test" }, "payloads": {} }
```

`keys` 是必填的（最多 200 个）。`context` 可以包含 `distinctId`、`userId`、`sessionId`、`visitId`、`anonymousId`、`path`、`url`、`hostname`、`referrer`、`language`、`userAgent`、`environment`、`release`、`groups`、`properties`、`personProperties` 和 `groupProperties`。`results` 中的每个键对应的值是变体键、`'test'`（已开启，没有变体）、`'control'`（未分配）或 `false`（已停用或未知）。`payloads` 列出每个已开启且带有负载的键的负载。使用网站 ID 的请求限制为每个 IP 每分钟 120 次，使用项目密钥的请求按密钥限制。这个端点不记录曝光。

### 某个用户的全部开关及其原因

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags/evaluate-all \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"distinctId":"user_123","keys":["checkout.new_flow"],"personProperties":{"plan":"pro"}}'
```

响应包含 `featureFlags`（变体键，或 `true`、`false`）、`featureFlagPayloads`，以及 `flags`，其中有每个开关的完整结果：`enabled`、`variant`、`reason`，以及作出决定的 `conditionGroup`。省略 `keys` 则返回所有开关。你发送的 `personProperties` 会叠加在已存储的属性之上。由于这个请求是 `POST`，密钥需要 **写入** 权限。它不记录曝光。

## 4. 曝光是如何记录的

用 `getFeatureFlag`、`isFeatureEnabled` 或 `useFeatureFlag` 读取开关会发送一个 `$feature_flag_called` 事件。每个开关在每次页面加载中只发送一次，`reset()` 之后会再发送一次。它带有以下属性：

| 属性 | 值 |
| --- | --- |
| `$feature_flag` | 开关键 |
| `$feature_flag_response` | 访客得到的结果，例如 `test`、`control` 或某个变体键 |
| `release`、`environment` | 来自 `data-release` 和 `data-environment`（如果设置了） |

读取开关之后，该页面上之后的每个事件还会带上带有变体的 `$feature/FLAG_KEY`，这样你就可以按变体对其他事件分组。发送 `$feature_flag_called` 事件的 PostHog SDK 同样被接受，并以同样的方式计数。见 [PostHog SDK](/docs/zh/install/posthog)。

在控制台中，打开开关并使用 **概览** 标签页：

- **曝光** 和 **会话** 统计 `$feature_flag_called` 事件及其对应的会话。
- **每日曝光**（按 UTC 天）、**实际分流**（每个变体的曝光数，旁边是配置的权重；没有变体的开关显示 **返回值**）和 **版本与环境** 显示曝光来自哪里。
- **最近曝光** 列出最近的 10 条，并附有每个会话的链接。
- 当有曝光的开关没有变体数据，或者有变体的开关把 90% 或更多的曝光分给了同一个变体时，会出现 **需要关注**。没有曝光的开关则显示 **还没有曝光**。

## 5. 测试开关

1. 打开开关，点击 **测试** 标签页。
2. 输入 **Distinct ID**，还可以选填 **路径**、**环境** 和 **版本**。
3. 点击 **运行评估**。

结果会显示开关是否 **命中**、变体、负载和原因，例如“匹配了条件组”“已匹配，但不在灰度范围内”或“没有匹配的条件组”。带 **Distinct ID** 运行评估会记录一次曝光。如果你想检查但不记录曝光，请使用 `evaluate-all` 或下面的 MCP 工具。

**变更历史** 标签页列出谁修改了开关以及改了什么。要关闭开关，请点击开关顶部的 **停用**；点击 **启用** 可以重新打开。

## 6. 通过 MCP 控制开关

[MCP 服务](/docs/zh/mcp) 可以让 AI 工具读取并切换开关。

| 工具 | 密钥权限 | 作用 |
| --- | --- | --- |
| `list_feature_flags` | 读取 | 列出开关及其状态、放量和变体。 |
| `evaluate_feature_flag` | 读取 | 为某个 distinct ID 评估一个开关。不记录曝光。 |
| `toggle_feature_flag` | 写入 | 按键打开或关闭开关。更改会出现在开关的历史中。 |
| `list_experiments` | 读取 | 列出实验及其结果。 |

在托管的 Flareboard 上，这些工具需要 Cloud 或 Business 套餐。

## 检查是否生效

1. 创建一个键为 `test.flag` 的开关，放量保持 100%。
2. 打开你的网站并等待几秒钟。在浏览器控制台中运行 `await flareboard.featureFlagsReady(); flareboard.isFeatureEnabled('test.flag')`，它会输出 `true`。
3. 在控制台中打开该开关。稍等片刻后，**曝光** 显示 1，**最近曝光** 列出你的这次访问。如果脚本还看不到这个开关，请等一分钟再刷新你的网站，因为脚本会把开关列表缓存 60 秒。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 开关始终读到 `false` | 开关已停用，键拼错了，或开关尚未加载。请等待 `featureFlagsReady()`，并检查代码片段中的网站 ID 是否正确。广告拦截器也可能拦截 `t.flareboard.dev`。 |
| 所有人读到的开关都是 `'control'` | 放量为 0%，访客不匹配任何条件组，或者开关需要服务端评估而结果还没到。请用 **测试** 标签页查看原因。 |
| 访客在之后的访问中得到了不同的变体 | 访客是匿名的，且网站没有记住访客。请调用 `identify()`，或开启 **跨会话识别访客**。 |
| 在控制台中的更改没有显示在网站上 | 脚本在每个标签页会话中把开关缓存 60 秒，配置响应还可能再缓存 60 秒。请在一两分钟后刷新。 |
| 没有出现任何曝光 | 只有 `getFeatureFlag`、`isFeatureEnabled` 和 `useFeatureFlag` 会记录曝光。`getFeatureFlagPayload` 和 `onFeatureFlags` 不会。 |
| 删除开关时返回 `409` | 有实验在使用该开关。请先删除实验。 |
| API 返回 `403`“Feature flags require a paid plan.” | 网站所有者使用的是 Free 套餐。见 [套餐与限制](/docs/zh/plans-limits)。 |

## 下一步

- 在开关之上用 [实验](/docs/zh/experiments) 衡量一次改动。
- 用 [问卷](/docs/zh/surveys) 询问访客的想法。
- 用 [MCP 服务](/docs/zh/mcp) 从 AI 工具中读取和切换开关。
