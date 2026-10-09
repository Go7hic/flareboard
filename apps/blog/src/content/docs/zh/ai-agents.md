---
title: 用 AI Agent 设置 Flareboard
sidebarTitle: AI Agent
description: 让 Claude Code、Cursor、Codex 或其他编程 Agent 在你的项目中安装 Flareboard。包括可直接粘贴的提示词、需要你亲自完成的步骤、如何验证，以及之后如何查询你的数据。
---

编程 Agent 可以在几分钟内把 Flareboard 加到你的项目里：安装追踪脚本，为注册和购买添加事件调用，并告诉你如何确认数据已经送达。账号相关的步骤需要你的登录信息，所以由你亲自完成。本页包含这些步骤、一段可粘贴的提示词，以及 Agent 应当遵守的规则。

## 你需要亲自完成的部分

Agent 不应创建你的账号，也不应接触你的凭据。请先完成这三件事：

1. **创建账号。** 打开 [flareboard.dev/register](https://flareboard.dev/register)，点击 **使用 GitHub 继续**，或用邮箱地址和密码注册。见 [快速开始](/docs/zh/quickstart)。
2. **添加网站。** 在控制台中打开 **网站**，点击 **添加网站**，输入 **名称** 和 **域名**，然后点击 **创建**。
3. **复制网站 ID。** Flareboard 会打开网站的设置页，安装代码在 **跟踪代码** 下。网站 ID 就是 `data-website-id` 中的 UUID。你只需要把这个 ID 交给 Agent。

不要把密码、恢复码或个人 API 密钥粘贴到与 Agent 的对话中。网站 ID 不是机密：脚本安装后，它会公开出现在你的页面源码里。

## 让 Agent 读取文档

每个文档页面都有纯 Markdown 版本，另有两个索引文件为机器列出所有页面：

| 地址 | 内容 |
| --- | --- |
| `https://flareboard.dev/docs/llms.txt` | 所有文档页面的列表，每页有一行说明和一个链接。 |
| `https://flareboard.dev/docs/llms-full.txt` | 所有文档页面合并成一个文件。文件很大，Agent 能放得下时再使用。 |
| 任一文档页面地址加 `.md` | 以 Markdown 形式返回单个页面，例如 `https://flareboard.dev/docs/quickstart.md`。 |

告诉 Agent 从 `llms.txt` 开始，只打开需要的页面。安装通常需要 [安装追踪脚本](/docs/zh/install/script)、[框架](/docs/zh/install/frameworks) 和 [追踪事件](/docs/zh/events)。

## 可粘贴的提示词

把 `YOUR_WEBSITE_ID` 替换成你的网站 ID，然后在项目根目录把下面的内容粘贴给你的 Agent（Claude Code、Cursor、Codex 或类似工具）：

```text
在这个项目中安装 Flareboard 分析。

请先阅读 https://flareboard.dev/docs/llms.txt。然后阅读它链接的页面，了解如何为本项目所用的框架安装追踪脚本，以及如何追踪事件。

我的网站 ID 是 YOUR_WEBSITE_ID。追踪脚本由 https://t.flareboard.dev/script.js 提供。

请按以下步骤操作：
1. 弄清楚这个项目使用哪个框架，以及 HTML head 或根布局在哪里。
2. 使用上面的网站 ID，把 Flareboard 的 script 标签加到每个页面。如果项目已经有包管理器和客户端应用，也可以按文档所述改用 @flareboard/js 包。
3. 为两个操作添加 flareboard.track() 调用：创建账号时的 "signup_completed"，以及付款成功时的 "purchase"。把每个调用放在确认成功的地方，而不是按钮被点击的地方。属性值要简短，例如套餐名称。
4. 永远不要把密码、支付信息、邮箱地址或任何其他个人数据作为事件属性发送，也不要读取表单字段的值。
5. 不要创建账号，也不要向我索要密码或 API 密钥。
6. 运行项目的构建或类型检查，向我展示改动内容，并告诉我如何用 Flareboard 控制台中的“测试连接”来确认。
```

如果你运行的是自己的 Flareboard 实例，请在提示词中把 `https://t.flareboard.dev` 换成你自己的采集地址。

## Agent 最终应该得到什么

对于普通的 HTML 网站，Agent 会在每个页面的 `<head>` 中加入：

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

脚本会记录页面浏览，包括单页应用中的路由切换，所以这些不需要写代码。对于事件，Agent 在某件事成功的地方调用 `track`：

```ts
flareboard.track('signup_completed', { plan: 'free' });
flareboard.track('purchase', { plan: 'pro' });
```

使用 script 标签时，脚本加载完成后 `flareboard` 可作为 `window.flareboard` 使用。使用 npm 包时，Agent 需要导入它，并尽早调用一次 `init`：

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev',
  websiteId: 'YOUR_WEBSITE_ID',
});
```

完整选项见 [npm 包](/docs/zh/install/npm)，命名和属性见 [追踪事件](/docs/zh/events)，以及 [识别用户](/docs/zh/events#识别用户)。

## Agent 须知的规则

如果你是正在阅读本页的 Agent，请遵守这些规则：

- 使用用户给你的网站 ID。不要创建账号，不要代用户登录，也不要索要密码或 API 密钥。
- Cloud 地址：仪表盘 `https://flareboard.dev`，API `https://api.flareboard.dev`，采集 `https://t.flareboard.dev`。自托管安装使用它自己的地址，请询问用户。
- 永远不要把字段值、密码、银行卡信息或其他个人数据作为事件名称或属性发送。自动采集不会记录访客输入的内容，你自己写的调用也不能记录。
- 把 script 标签放在共享布局中，让每个页面都有，而不是只放在某一个页面。
- 不要为所有东西都凭空发明事件名称。只添加用户要求的事件。
- 在说完成之前，先运行项目自己的构建或类型检查。

## 检查是否生效

1. 部署改动，或在本地运行网站并用浏览器打开。点几个页面；如果可以，把注册或购买流程走一遍。
2. 在控制台中打开 **网站**，进入网站的 **设置**，点击代码旁的 **测试连接**。
   - 显示 **已连接**，并带有 **最近事件时间** 和一个时间，说明已经生效。
   - 显示 **等待数据**，说明脚本可以访问，但过去 15 分钟内没有数据到达。请刷新你的网站后再测试一次。
3. 打开该网站的 **实时**，几秒内就能看到你的访问。

连接 [MCP 服务](#用-ai-agent-查询数据) 之后，Agent 可以自己检查：让它用 `run_insight` 工具统计今天的页面浏览量（页面浏览的 kind 为 `pageview`），并用 `list_event_names` 列出自定义事件，它添加的事件在触发后会出现在其中。密钥保存在 MCP 配置中，永远不要放进对话。

没有数据？见 [故障排查](/docs/zh/troubleshooting)。常见原因有：你自己浏览器里的广告拦截器、拦截了 `t.flareboard.dev` 的 Content Security Policy，或网站 ID 填错。

## 用 AI Agent 查询数据

数据流入之后，同一个 Agent 可以通过 [MCP 服务](/docs/zh/mcp) 回答关于数据的问题。个人 API 密钥由你在控制台中亲自创建（打开账户菜单，即侧边栏底部你的名字，然后选择 **API 密钥**），再把它加到 Agent 的 MCP 配置中，而不是加到对话或你的代码里。对于 Claude Code，只需一条命令：

```bash
claude mcp add --transport http flareboard https://api.flareboard.dev/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

除非你希望 Agent 添加注释或开启、关闭功能开关，否则只选择 **读取** 权限范围。不再需要时，在 **API 密钥** 页面撤销该密钥。Claude Desktop、Cursor 和其他客户端的配置见 [MCP 服务](/docs/zh/mcp) 页面。

然后用自然语言提问，例如：

- “过去 7 天我们收到了多少个 `signup_completed` 事件？”
- “建立一个从首页到 `signup_completed` 和 `purchase` 的转化漏斗。”
- “本周最主要的错误问题有哪些？”

需要直接调用 Flareboard 的脚本，见 [REST API](/docs/zh/api)。

## 故障排查

- **Agent 加了标签，但没有数据。** 检查标签中的网站 ID 是否与控制台中的一致，以及标签是否在你访问的页面上。有多个布局的框架需要在每个布局中都加上标签。
- **Agent 用了错误的地址。** 脚本由采集地址提供（Cloud 上是 `https://t.flareboard.dev`），不是 `flareboard.dev`，也不是 API 地址。
- **Agent 无法访问文档。** 把页面内容粘贴到对话中，或给它页面的 `.md` 地址。
- **事件出现了，但是空的或太杂。** 让 Agent 只追踪你指定的事件，并阅读 [追踪事件](/docs/zh/events) 了解属性方面的建议。
