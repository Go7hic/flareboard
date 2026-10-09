---
title: 数据仓库与收入
description: 对事件运行只读 SQL，接入 HTTP 数据源或 Stripe 的外部数据，并在收入页面查看收入、MRR 和流失。
---

**数据仓库** 让你用 SQL 查询 Flareboard 的数据，并加入外部数据：来自 URL 的 JSON 或 CSV 文件，以及你的 Stripe 账户。**收入** 页面使用同样的数据来显示收入、订阅和 MRR。你还可以从其他分析工具导出的 CSV 中导入旧的页面浏览数据。

## 开始之前

- 一个有数据的网站。见 [快速开始](/docs/zh/quickstart)。
- 在 Flareboard Cloud 上，数据仓库需要 Cloud 或 Business 套餐。没有它时，数据仓库 API 会返回 `403` `Warehouse requires a paid plan.`。自托管安装没有套餐限制。见 [套餐与限制](/docs/zh/plans-limits)。
- 创建数据源、已保存的查询和定时任务需要网站的编辑权限。

## 1. 运行 SQL

打开网站，再打开 **数据仓库**（在 **数据** 下）。标签有：**查询**、**已保存**、**历史**、**定时** 和 **数据源**。

在 **查询** 中，于 **数据仓库 SQL** 里编写 SQL，然后点击 **运行查询**。编辑器会在你输入时检查查询（**查询检查**），并列出 **示例查询** 和 **站点数据表**。点击 **导出 CSV** 可以下载结果。

### 规则

- 只能是一条以 `SELECT` 或 `WITH` 开头的只读语句。不能有分号，也不能有注释（`--` 或 `/* */`）。
- 必须包含 `website_id = ?1`。`?1` 会自动填入网站的 ID。查询只会看到这个网站的数据行，并且 `website_id` 不能用其他方式比较。
- 会写入或修改数据的关键字无论出现在哪里都会被拒绝：`INSERT`、`UPDATE`、`DELETE`、`DROP`、`ALTER`、`CREATE`、`REPLACE`、`TRUNCATE`、`ATTACH`、`DETACH`、`PRAGMA`、`VACUUM`、`REINDEX`。
- `UNION`、`INTERSECT` 和 `EXCEPT` 会被拒绝。带引号的标识符、带 schema 限定的名称和内部表也会被拒绝。
- 只能使用下面列出的表。可以对它们做连接和 CTE（`WITH`）。

### 限制

| 限制 | 值 |
| --- | --- |
| 显示的行数 | 最多 1,000。不带 `LIMIT` 的查询返回 100 行 |
| 每次查询扫描的行数 | 100,000 |
| 运行时间 | 10 秒 |
| CSV 导出 | 最多 10,000 行。行数被上限截断时，控制台会提示；添加筛选或 `LIMIT`，分批导出其余部分 |
| 查询频率 | 每个用户在每个网站上每分钟 20 次 |

### 表

`created_at` 列是自纪元起的毫秒数。编辑器中的 **站点数据表** 列表始终显示当前的列。

| 表 | 内容 |
| --- | --- |
| `website_event` | 页面浏览、自定义事件、错误、日志、AI 调用等。主要列：`event_id`、`session_id`、`visit_id`、`created_at`、`url_path`、`event_type`、`event_name`、`revenue`、`currency`。`event_type` 是数字：1 页面浏览、2 自定义事件、5 性能、8 错误、9 日志、10 AI |
| `event_data` | 每个事件属性一行：`website_event_id`、`data_key`、`string_value`、`number_value`、`data_type` |
| `session` | 访客会话：`browser`、`os`、`device`、`country`、`region`、`city`、`language`、`created_at` |
| `survey_response` | 问卷回答：`survey_id`、`session_id`、`answer`、`url_path`、`created_at` |
| `workflow_execution` | 工作流运行：`workflow_id`、`event_name`、`status`、`error`、`created_at` |
| `revenue` | 每个追踪到的收入事件一行：`event_name`、`currency`、`revenue`、`created_at` |
| `person` | 已识别的用户：`distinct_id`、`properties_json`、`first_seen_at`、`last_seen_at` |
| `warehouse_import` | 来自 HTTP JSON 和 CSV 数据源的行（见下文） |
| `stripe_customer`、`stripe_charge`、`stripe_refund`、`stripe_invoice`、`stripe_invoice_line`、`stripe_subscription` | Stripe 数据（见下文） |

使用按网站划分的存储时，查询最多只能看到 `survey_response` 和 `workflow_execution` 最新的 50,000 行。

### 示例

最多的自定义事件：

```sql
SELECT event_name AS eventName, COUNT(*) AS events
FROM website_event
WHERE website_id = ?1 AND event_name IS NOT NULL
GROUP BY event_name
ORDER BY events DESC
LIMIT 20
```

按国家统计会话：

```sql
SELECT COALESCE(country, 'unknown') AS country, COUNT(*) AS sessions
FROM session
WHERE website_id = ?1
GROUP BY COALESCE(country, 'unknown')
ORDER BY sessions DESC
LIMIT 20
```

工作流失败：

```sql
SELECT event_name AS eventName, error, created_at AS createdAt
FROM workflow_execution
WHERE website_id = ?1 AND status = 'failed'
ORDER BY created_at DESC
LIMIT 50
```

Stripe 按月收入：

```sql
SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, currency, SUM(amount_major) AS revenue, COUNT(*) AS charges
FROM stripe_charge
WHERE website_id = ?1 AND paid = 1 AND status = 'succeeded'
GROUP BY month, currency
ORDER BY month DESC
LIMIT 24
```

### 保存、重复运行与定时

- **保存查询**：把 SQL 连同 **查询名称** 保存到 **已保存** 下，网站上的所有人都能看到。**加载** 会把它放回编辑器。
- **历史**：该网站最近的运行，包含状态、行数和错误。
- **定时**：在 **查询** 中编写 SQL，然后点击 **新建定时查询**，输入 **名称** 和 **间隔（分钟）**。定时任务会反复运行编辑器中的 SQL。它会记录最近一次的状态和行数，并添加一条 **历史** 记录，但不会存储或发送结果。到期的任务在每小时的定时任务中运行，或在你点击 **运行到期任务** 时运行。

### 通过代码调用

`POST /api/websites/WEBSITE_ID/warehouse/query`，请求体为 `{"sql": "…"}`，即可运行一次查询。它需要带有 **写入** 范围的个人 API 密钥。见 [API](/docs/zh/api)。

## 2. 添加数据源

打开 **数据仓库**，再打开 **数据源**，点击 **新建数据源**。选择一个 **数据源类型**。每个数据源都会显示它的状态（**已连接**、**同步中** 或 **失败**）和 **上次同步**。点击 **立即同步** 可以马上同步。它不受 `syncIntervalMinutes` 限制，但距上次同步需满一分钟，点得太快时会提示。已启用的数据源也会在每小时的定时任务中同步。

### HTTP JSON 和 HTTP CSV

输入 **配置（JSON）**：

```json
{
  "url": "https://example.com/customers.json",
  "primaryKey": "id",
  "syncIntervalMinutes": 60
}
```

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `url` | 无，必填 | 公网的 `http` 或 `https` 地址。Flareboard 用 `GET` 获取它，不带请求头，也不跟随重定向。它不能包含用户名或密码，私有地址、回环地址和内部主机会被拒绝 |
| `primaryKey` | `id` | 用来标识一行的字段。没有该字段值的行会被跳过 |
| `syncIntervalMinutes` | 无 | 每小时的定时任务在距离上次同步满这么多分钟之前跳过该数据源。**立即同步** 不受影响。大于 1,440 的值按 1,440 计 |

**HTTP JSON** 数据源必须返回由对象组成的 JSON 数组。**HTTP CSV** 数据源必须返回带有表头行的 CSV。响应最多 10,000 行、最大 5 MB，请求在 15 秒后超时。每次同步按主键执行 upsert。

行会进入 `warehouse_import`。从 `payload_json` 读取字段：

```sql
SELECT primary_key, json_extract(payload_json, '$.plan') AS plan
FROM warehouse_import
WHERE website_id = ?1 AND data_source_id = 'YOUR_DATA_SOURCE_ID'
LIMIT 50
```

查询编辑器的 schema 面板会在 **导入的数据** 下列出每个数据源导入的字段，并附带一个示例查询。

### Stripe

Stripe 连接器会把客户、订阅、带明细行的发票、扣款和退款复制到 `stripe_*` 表中。

1. 在 Stripe 中，打开 **Developers**（开发者），再打开 **API keys**（API 密钥），创建一个受限密钥，对 Customers、Charges、Refunds、Invoices、Subscriptions 和 Events 授予 **Read**（读取）权限。
2. 在 Flareboard 中，点击 **新建数据源**，选择 **Stripe**，输入名称，把密钥粘贴到 **受限 API 密钥**，然后创建数据源。

只接受受限密钥（`rk_live_…` 或 `rk_test_…`）。完整的密钥（secret key，`sk_…`）会被拒绝。密钥会加密存储，之后不再显示：控制台只显示形如 `rk_live_…4242` 的提示。删除数据源时，Flareboard 会连同密钥和已导入的 Stripe 数据一起删除。已删除网站的数据被清除时，密钥也会被清除。

首次同步会分批导入你的 Stripe 历史数据（**正在导入历史数据…**），并在每小时的定时任务中继续，直到完成。之后它会应用 Stripe 的事件流，所以退款、取消和已支付的发票都会同步过来。Stripe 只保留 30 天的事件。如果同步落后得更多，导入会从头开始。客户会通过 Stripe 客户元数据中的 `distinct_id`，或通过匹配邮箱，关联到用户，所以你可以把收入与用户关联起来。

**更换密钥** 会换上新的密钥。因为它可能属于另一个 Stripe 账户，所以这会删除用旧密钥导入的数据，并从头重新同步。Stripe 数据源的类型无法更改。

有用的列：`stripe_charge`、`stripe_refund` 和 `stripe_invoice_line` 上的 `amount_major`（以货币的主单位计，例如美元），以及 `stripe_invoice_line` 和 `stripe_subscription` 上的 `mrr_major`。

## 3. 收入与 MRR

打开网站，再打开 **收入**（在 **增长** 下）。收入来自两个来源，会放在一起显示，并且不会跨币种求和：

- **追踪事件**：你带金额追踪的购买。在浏览器中调用 `flareboard.revenue(49, 'USD', { name: 'checkout' })`。在服务端，在事件负载中发送 `revenue` 和 `currency`（两者都需要）。见 [追踪事件](/docs/zh/events) 和 [从服务端发送事件](/docs/zh/install/server)。
- **Stripe**：连接 Stripe 后，成功的扣款计为收入，退款则从中扣除。

页面按币种显示 **合计**、**笔数** 和 **每日收入**，以及 **按事件的收入**。**付费最多的会话** 可以让你打开一个会话，查看购买路径。

**订阅** 显示根据 Stripe 订阅发票（未结清或已支付，不含按比例计费）得出的 MRR，按每月月底计算，包括：

- **MRR**、**ARR**、**活跃订阅者**、**流失率（上月）** 和 **ARPU**。
- **MRR 变动**：**新增**、**扩展**、**收缩** 和 **流失**。

时间范围会至少扩展到 12 个月，以便月度数字完整。没有 Stripe 数据时，页面会显示 **暂无订阅数据**，并指引你前往 **数据仓库**，再到 **数据源**。

**收入归因** 把每笔交易计到付费者的首次访问（首次触点），在不知道付费者时则计到购买会话。选择一个维度：UTM 来源、媒介、活动或来源页。没有已知来源的交易显示为 **直接访问**。

**导出交易**（最多 50,000 行，最新的在前）、**导出归因** 和 **导出 MRR** 会下载 CSV 文件。在 Flareboard Cloud 上，导出需要 Cloud 或 Business 套餐。

## 4. 从 CSV 导入旧的页面浏览数据

如果你之前使用过其他工具，可以导入它导出的页面浏览数据。打开网站的 **设置**，找到 **数据导入**，选择一个 **格式**，然后上传文件（**上传 CSV 文件**，最大 20 MB）或粘贴 CSV，再点击 **导入**。

| 格式 | 必需的列 |
| --- | --- |
| Google Analytics 4 CSV | `Date` 和 `Page path`。`Views`（或事件数）会让该行重复 |
| Plausible CSV | `date` 和 `page`。`pageviews` 或 `visitors` 会让该行重复 |
| Matomo CSV | 一个页面 URL 列。存在时会使用 `date` 和 `hits` |
| Flareboard CSV | `timestamp` 和 `url_path`。可选 `session_id` 和 `event_name` |

每个导入的行都会变成一个页面浏览事件（Flareboard 格式带有 `event_name` 时则是自定义事件），并带有一个新的匿名会话。带计数的行会创建相应数量的页面浏览。结果会说明导入和跳过了多少行，并附带最多 50 条错误消息。在 Flareboard Cloud 上，导入需要 Cloud 或 Business 套餐，以及网站的编辑权限。

## 检查是否生效

1. 打开 **数据仓库**，运行 `SELECT COUNT(*) AS events FROM website_event WHERE website_id = ?1`。你会得到一行结果。
2. 添加一个指向小型公开 JSON 文件的 HTTP JSON 数据源，然后点击 **立即同步**。状态变为 **已连接**，并且 `warehouse_import` 里有数据行。
3. 对于 Stripe，等待首次同步完成（**正在导入历史数据…** 标签消失）。然后打开 **收入**。**订阅** 会显示 MRR。

## 故障排查

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| `Warehouse queries must scope reads with website_id = ?1` | 查询中没有 `website_id = ?1` | 把它加到 `WHERE` 子句中 |
| `Table not allowed in warehouse queries` | 查询使用了列表之外的表 | 只使用上面列出的表 |
| `Query scanned … rows; maximum allowed is 100,000` | 查询读取的数据过多 | 添加筛选，例如对 `created_at` 加时间范围 |
| `Query exceeded 10000ms timeout` | 查询太慢 | 缩小范围并添加 `LIMIT` |
| `Rate limit exceeded` | 每分钟超过 20 次查询 | 等待一分钟 |
| `Stripe needs a restricted API key (rk_live_… or rk_test_…) with read access` | 你粘贴的是 secret key，或格式错误的密钥 | 在 Stripe 中创建一个受限密钥 |
| 数据源状态为 **失败**，并提示 `Expected JSON array response` | URL 返回的不是 JSON 数组 | 返回由对象组成的数组，或改用 HTTP CSV |
| 数据源状态为 **失败**，并提示 `Import URL host is not allowed` | URL 指向私有或内部主机 | 使用公网地址 |
| `Import exceeds 10000 rows` | 响应的行数过多 | 拆分它，或提供更小的文件 |
