---
title: Flareboard 文档
sidebarTitle: 简介
description: 了解如何把 Flareboard 接入网站或应用、发送事件，以及使用分析、回放、功能开关、错误追踪和 API。面向开发者，也面向帮助他们的 AI 智能体。
---

Flareboard 是跑在 Cloudflare 上的产品分析工具。只需一个 script 标签（或沿用你现有的 PostHog SDK），就能在同一个仪表盘里获得网站分析、漏斗、留存、会话回放、热力图、功能开关、实验、问卷反馈、错误追踪、日志和 LLM 成本追踪。

有两种使用方式：

- **Flareboard Cloud**：访问 [flareboard.dev](https://flareboard.dev)，由我们为你运行。Free 套餐包含一个网站，每月 10 万个事件。
- **自托管**：用同一份代码部署在你自己的 Cloudflare 账号上，非商业用途免费。见 [自托管 Flareboard](/docs/zh/self-host/deploy)。

## 从这里开始

1. [快速开始](/docs/zh/quickstart)：创建账号、添加网站、安装脚本，并看到第一次访问。大约五分钟。
2. [概念](/docs/zh/concepts)：网站、项目密钥、访客、会话和事件，以及如何在不使用 Cookie 的情况下统计访客。
3. [安装追踪脚本](/docs/zh/install/script)，或选择其他发送数据的方式：[npm 包](/docs/zh/install/npm)、[框架](/docs/zh/install/frameworks)、[PostHog SDK](/docs/zh/install/posthog) 或 [服务端事件](/docs/zh/install/server)。

## 常见任务

| 我想要 | 阅读 |
| --- | --- |
| 统计页面浏览和访客 | [网站分析](/docs/zh/web-analytics) |
| 追踪注册、购买等行为 | [追踪事件](/docs/zh/events) |
| 查看用户在哪一步流失 | [产品分析](/docs/zh/product-analytics) |
| 回看访客做了什么 | [会话回放](/docs/zh/session-replay) |
| 向部分用户发布功能 | [功能开关](/docs/zh/feature-flags) |
| 发现并修复 JavaScript 错误 | [错误追踪](/docs/zh/error-tracking) |
| 在 Claude、Cursor 或其他 AI 工具中查询我的数据 | [MCP 服务](/docs/zh/mcp) |
| 在自己的代码里读取或修改数据 | [REST API](/docs/zh/api) |

## 配合 AI 智能体使用

这些文档的写法方便智能体照着操作。每个页面也提供纯 Markdown 版本：在地址后加上 `.md`（例如 [/docs/quickstart.md](/docs/quickstart.md)）。[/docs/llms.txt](/docs/llms.txt) 列出了所有页面，[/docs/llms-full.txt](/docs/llms-full.txt) 把全部页面合并在一个文件里。

想让智能体在你的项目中安装 Flareboard，见 [用 AI 智能体设置 Flareboard](/docs/zh/ai-agents)。

## 获取帮助

- 发邮件到 [support@flareboard.dev](mailto:support@flareboard.dev)。
- 在 [GitHub](https://github.com/Go7hic/flareboard/issues) 上报告问题。
- 试用 [在线演示](https://flareboard.dev/demo)，使用示例数据，无需账号。
