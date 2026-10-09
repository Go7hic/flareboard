---
title: 快速开始
description: 创建 Flareboard Cloud 账号，添加网站，安装追踪脚本，并确认第一次页面浏览已送达。
---

本指南带你从没有账号到看到实时数据，大约五分钟。这里使用 Flareboard Cloud。如果你运行自己的实例，请先按 [自托管 Flareboard](/docs/zh/self-host/deploy) 部署，再从第 2 步继续，并使用你自己的仪表盘和采集地址。

## 开始之前

- 一个你可以编辑的网站：需要在它的 HTML 中加一行代码。
- 一个邮箱地址，或一个 GitHub 账号。

## 1. 创建账号

1. 打开 [flareboard.dev/register](https://flareboard.dev/register)。
2. 点击 **使用 GitHub 继续**，或输入邮箱地址和密码（至少 8 个字符），然后点击 **创建账号**。
3. 如果用邮箱注册，打开验证邮件并点击其中的链接。之后你就登录到控制台了。

## 2. 添加网站

1. 在控制台中打开 **网站**，点击 **添加网站**。
2. 输入 **名称**（例如 `My site`）和网站所在的 **域名**（例如 `example.com`）。
3. 点击 **创建**。

Flareboard 会创建网站，并打开带有安装代码的设置页。每个网站都有一个 **网站 ID**（UUID），代码用它把数据发送到正确的位置。

## 3. 安装追踪脚本

从网站设置中复制代码，粘贴到每个页面的 `<head>` 中。它的样子如下，其中是你自己的网站 ID：

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

基础安装只需要这一步。这个脚本：

- 在页面加载时和每次客户端路由切换时记录一次页面浏览，所以单页应用无需额外代码；
- 不设置 Cookie，也不存储 IP 地址；
- gzip 后约 12 KB，并用 `defer` 加载，不会阻塞渲染。

使用 React、Next.js、Vue 或其他框架？标签放在哪里见 [框架](/docs/zh/install/frameworks)，也可以使用 [npm 包](/docs/zh/install/npm)。

## 4. 检查是否生效

1. 在浏览器中打开你的网站，随便点几个页面。
2. 在控制台中打开网站的设置，点击代码旁的 **测试连接**。
   - 显示 **已连接**，并带有 **最近事件时间** 和一个时间，说明已经完成。
   - 显示 **等待数据**，并提示“采集脚本可访问。请访问你的网站以发送首次浏览量。”，说明脚本可以访问，但过去 15 分钟内没有数据到达。请刷新网站后再测试一次。
3. 打开该网站的 **实时**。你的访问会在几秒内出现。

没有数据？见 [故障排查](/docs/zh/troubleshooting)。常见原因有：你自己浏览器里的广告拦截器、拦截了 `t.flareboard.dev` 的 Content Security Policy，或网站 ID 填错。

## 下一步

- 用 `flareboard.track()` [追踪事件](/docs/zh/events)，例如注册和购买。
- 用户登录后 [识别用户](/docs/zh/events#识别用户)，让他们的会话连起来。
- 开启 [会话回放](/docs/zh/session-replay) 来回看访问（在 Flareboard Cloud 上需要 Cloud 或 Business 套餐）。
- 邀请团队成员：[团队与权限](/docs/zh/teams)。
