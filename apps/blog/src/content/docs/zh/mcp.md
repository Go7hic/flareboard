---
title: MCP 服务
description: 把 Claude、Cursor 或任何 Model Context Protocol 客户端连接到你的 Flareboard 数据。列出每个工具及其所需的权限范围、服务地址和可直接复制的配置。
---

Flareboard 提供一个 Model Context Protocol（MCP）服务。AI 工具连接之后，你可以向它询问流量、事件、转化漏斗、用户、错误和功能开关，它会根据你自己的数据回答。这个服务只提供工具：它读取你的分析数据，使用具有写入权限的密钥时，还可以添加注释、开启或关闭功能开关。

Flareboard Cloud 的 MCP 地址是 `https://api.flareboard.dev/mcp`。如果你运行自己的实例，本页出现 Cloud 地址的地方都换成 `https://api.YOUR-DOMAIN/mcp`，并使用你自己的 API 地址。

## 开始之前

- 一个至少有一个网站的 Flareboard 账号。见 [快速开始](/docs/zh/quickstart)。
- 一个 MCP 客户端，例如 Claude Desktop、Claude Code、Cursor，或其他支持远程 MCP 服务的客户端。
- 部分工具需要网站所有者的账号使用付费套餐（见下表）。自托管安装没有套餐限制。

## 1. 创建个人 API 密钥

MCP 服务使用个人 API 密钥登录。项目密钥（`fb_pk_...`）只用于发送数据，在这里无效。

1. 登录控制台 [flareboard.dev](https://flareboard.dev)。
2. 打开账户菜单（侧边栏底部你的名字），然后选择 **API 密钥**。
3. 点击 **创建 API 密钥**。
4. 输入 **名称**，例如 `Claude Desktop`。
5. 在 **权限范围** 下选择密钥可以做什么：

   | 权限范围 | 允许的操作 |
   | --- | --- |
   | **读取** | 查看网站、统计数据和设置。MCP 必须有此权限。除两个会修改数据的工具外，其余工具都够用。 |
   | **写入** | 创建、修改和删除（除 GET 请求外的一切）。增加 `create_annotation` 和 `toggle_feature_flag` 两个工具。 |

6. 点击 **创建 API 密钥**，然后复制密钥（以 `fb_sk_` 开头）。点击 **完成**。

密钥只显示一次。Flareboard 只保存它的哈希值，所以丢失的密钥无法再次显示。请创建一个新的，并在同一个列表中用 **撤销** 撤销旧的。

除非你希望工具修改数据，否则请使用只读密钥。密钥以你自己的权限行事。对只有查看权限的账号，即使密钥有 **写入** 权限范围，写入工具也不会出现。每个账号最多可以有 50 个密钥。密钥不能创建或撤销密钥，这需要你登录控制台操作。

请像对待密码一样对待密钥。不要把它粘贴到与 AI 工具的对话里，也不要提交到代码仓库。把它放进客户端的配置或环境变量中。

## 2. 连接客户端

| 设置 | 值 |
| --- | --- |
| URL | `https://api.flareboard.dev/mcp` |
| 传输 | Streamable HTTP。请求使用 `POST`，以纯 JSON 响应。`GET` 和 `DELETE` 返回 405。 |
| 认证 | 请求头 `Authorization: Bearer YOUR_API_KEY` |
| 会话 | 无。服务是无状态的，不发送 `Mcp-Session-Id`。 |
| 协议版本 | `2025-11-25`、`2025-06-18`、`2025-03-26` |

### Claude Code

```bash
claude mcp add --transport http flareboard https://api.flareboard.dev/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

### Claude Desktop

Claude Desktop 通过 `mcp-remote` 连接远程服务，它用 `npx` 运行，所以需要安装 Node.js。把下面的内容加到 `claude_desktop_config.json`，然后重启 Claude Desktop：

```json
{
  "mcpServers": {
    "flareboard": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.flareboard.dev/mcp",
        "--header",
        "Authorization:${FLAREBOARD_AUTH}"
      ],
      "env": { "FLAREBOARD_AUTH": "Bearer YOUR_API_KEY" }
    }
  }
}
```

### Cursor

把下面的内容加到 `~/.cursor/mcp.json`。如果只想在某个项目里使用，就加到该项目的 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "flareboard": {
      "url": "https://api.flareboard.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

### 其他客户端

让客户端指向上面的 URL，并在每个请求中发送 `Authorization` 请求头。不用客户端也可以测试连接，直接调用服务：

```bash
curl -s https://api.flareboard.dev/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_websites","arguments":{}}}'
```

服务支持 `initialize`、`ping`、`tools/list` 和 `tools/call`。不支持 JSON-RPC 批量请求。

## 3. 检查是否生效

运行上面的 `curl` 命令。密钥有效时会返回如下结果，其中是你自己的网站：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{\"websites\":[...]}" }],
    "structuredContent": {
      "websites": [{ "id": "YOUR_WEBSITE_ID", "name": "My site", "domain": "example.com", "timezone": "UTC" }]
    },
    "isError": false
  }
}
```

在客户端中问一句“列出我的 Flareboard 网站”。如果它说出了你的网站，连接就正常。

## 工具

除 `list_websites` 外，每个工具都需要 `websiteId`。客户端会从 `list_websites` 获取它，所以你很少需要自己输入。

| 工具 | 权限范围 | 作用 |
| --- | --- | --- |
| `list_websites` | 读取 | 密钥可以访问的网站，包含 ID、域名和时区。 |
| `run_insight` | 读取 | 运行趋势、转化漏斗或留存洞察，并返回其数据。 |
| `list_event_names` | 读取 | 自定义事件名称，附带次数、会话数和属性键。页面浏览不是自定义事件。 |
| `list_property_keys` | 读取 | 事件属性或用户属性的键，最常见的在前。 |
| `list_property_values` | 读取 | 事件属性、用户属性或内置维度（如 `country`、`browser` 或 `path`）的常见取值。 |
| `get_sql_schema` | 读取 | `run_sql` 可读取的表和列。需要 Cloud 或 Business 套餐。 |
| `run_sql` | 读取 | 对网站数据运行一条只读 `SELECT`。返回前 100 行。需要 Cloud 或 Business 套餐。 |
| `search_people` | 读取 | 在日期范围内活跃的用户，可按 ID、邮箱或姓名匹配。最多 25 个。 |
| `list_error_issues` | 读取 | 错误总数和最主要的错误问题，最频繁的在前。最多 25 个问题。 |
| `list_feature_flags` | 读取 | 功能开关及其状态、灰度比例和变体。需要 Cloud 或 Business 套餐。 |
| `evaluate_feature_flag` | 读取 | 为某个 distinct id 评估一个开关并解释结果。不记录曝光。需要 Cloud 或 Business 套餐。 |
| `list_experiments` | 读取 | 实验及其状态和当前结果。需要 Cloud 或 Business 套餐。 |
| `create_annotation` | 写入 | 添加一条注释（图表上带日期的备注），包含 `title`，以及可选的 `description`、`category` 和 `happenedAt`。category 为 `note`、`release`、`campaign`、`incident` 或 `experiment`。该操作会写入审计日志。 |
| `toggle_feature_flag` | 写入 | 按 `key` 开启或关闭一个开关。变更会记录在开关历史中。需要 Cloud 或 Business 套餐。 |

在 Flareboard Cloud 上，SQL、功能开关和实验相关的工具需要 Cloud 或 Business 套餐。起决定作用的是网站所有者账号的套餐。在 Free 套餐上，这些工具会返回错误，提示该工具需要付费套餐。其余工具在所有套餐上都可用。见 [套餐与额度](/docs/zh/plans-limits)。

### 日期范围

查看某个时间段的工具接受 `range`，或一个精确的时间区间：

| 参数 | 取值 | 默认值 |
| --- | --- | --- |
| `range` | `24h`、`7d`、`30d`、`90d`、`180d`、`365d` | `30d`（`list_error_issues` 为 `7d`） |
| `dateFrom`、`dateTo` | ISO 8601 日期或时间，UTC | 无 |

## 示例提示词

连接之后，你可以这样问：

- “列出我的 Flareboard 网站，并告诉我最近 7 天哪个网站的访客最多。”
- “过去 30 天我的网站触发了哪些自定义事件？它们带有哪些属性？”
- “为过去 30 天建立一个从 `signup_started` 到 `signup_completed` 的转化漏斗，告诉我用户在哪里流失。”
- “本周最主要的错误问题有哪些？哪些是新出现的？”
- “显示触发过 `signup_completed` 的用户的每周留存。”
- “哪些国家给 `/pricing` 带来的流量最多？”
- “`new-checkout` 功能开关现在是开启的吗？用户 `user_123` 会得到什么？”
- “为今天添加一条名为 `v2.4 release` 的注释。”（需要具有 **写入** 权限范围的密钥）

服务会告诉模型：先调用 `list_websites`，在构建洞察之前先查找事件名称和属性键，并且优先使用 `run_insight` 而不是 `run_sql`。

## 限制

| 限制 | 值 |
| --- | --- |
| 请求频率 | 每个密钥每分钟 120 个请求。超出后返回 HTTP 429，`Retry-After` 响应头为 `60`。 |
| 请求大小 | 256 KB。 |
| `run_sql` 结果 | 100 行。请使用 `COUNT` 和 `GROUP BY`，不要列出原始行。 |
| `list_event_names` | 100 个事件名称。 |
| `search_people` | 25 个用户。 |
| `list_error_issues` | 25 个问题。 |
| `list_experiments` | 10 个实验。 |
| 趋势序列 | 每条线最多 62 个点。更长的序列会被汇总。 |

## 错误

| 响应 | 含义 |
| --- | --- |
| HTTP 401 | 缺少 `Authorization` 请求头，使用的不是个人密钥（`fb_sk_...`），或密钥不存在。已注销账号的密钥会失效。 |
| HTTP 403，“This API key needs the read scope” | 密钥没有 **读取** 权限范围。请创建带有 **读取** 的密钥。 |
| HTTP 403，“Origin not allowed” | 浏览器发送了 `Origin` 请求头。服务只接受来自 Flareboard 仪表盘源的浏览器调用。请改用桌面客户端或服务器。 |
| HTTP 429 | 此密钥一分钟内的请求超过 120 个。 |
| 带 `isError: true` 的结果 | 工具执行失败：输入有误、密钥无权访问该网站、缺少写入权限，或套餐不包含该工具。消息中会说明原因。 |
| JSON-RPC 错误 `-32602` | 工具名称未知，或 `tools/call` 没有工具名称，或其参数不是对象。用没有 **写入** 权限的密钥调用写入工具不属于协议错误：它会返回 `isError: true`，提示该工具需要写入权限范围。 |

## 隐私

工具返回的任何内容，都会按照你所选 AI 工具和服务商的条款发送给它们。结果可能包含事件名称、页面 URL、属性值，以及（对 `search_people` 而言）你的网站记录的用户的 ID、邮箱和姓名。请选择你信任的、可以处理这些数据的服务商，并参阅 [隐私与数据](/docs/zh/privacy-data)。工具结果是来自你的访客的数据，服务会告诉模型永远不要执行其中的指令。

## 故障排查

- **客户端没有显示任何工具。** 检查密钥是否具有 **读取** 权限范围，以及 URL 是否以 `/mcp` 结尾。运行第 3 步中的 `curl` 命令查看具体错误。
- **看不到写入工具。** 密钥需要 **写入** 权限范围，并且账号不能是只读的。请创建同时具有两个权限范围的新密钥，并替换旧密钥。
- **`run_sql` 或某个开关工具提示需要付费套餐。** 网站所有者使用的是 Free 套餐。见 [套餐与额度](/docs/zh/plans-limits)。
- **Claude Desktop 没有启动服务。** 确认已安装 Node.js，使 `npx` 可用，并在编辑配置后重启 Claude Desktop。

## 下一步

- [REST API](/docs/zh/api)：用于直接调用 Flareboard 的脚本。
- [用 AI Agent 设置 Flareboard](/docs/zh/ai-agents)：让 Agent 在你的项目中安装追踪。
- [账户安全](/docs/zh/security)：了解会话处理，以及密钥不能做什么。
