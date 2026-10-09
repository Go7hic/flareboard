---
title: MCP server
description: Connect Claude, Cursor or any Model Context Protocol client to your Flareboard data. Lists every tool, the scope each one needs, the server address and copyable config.
---

Flareboard runs a Model Context Protocol (MCP) server. Once an AI tool is connected, you can ask it questions about your traffic, events, funnels, people, errors and feature flags, and it answers from your own data. The server only has tools. It reads your analytics and, with a write key, can add annotations and turn feature flags on or off.

Flareboard Cloud serves MCP at `https://api.flareboard.dev/mcp`. If you run your own copy, use `https://api.YOUR-DOMAIN/mcp` with your own API address wherever this page shows the Cloud one.

## Before you start

- A Flareboard account with at least one website. See the [Quickstart](/docs/quickstart).
- An MCP client such as Claude Desktop, Claude Code, Cursor or another client that supports remote MCP servers.
- Some tools need a paid plan on the website owner's account (see the table below). On self-hosted installs there are no plan limits.

## 1. Create a personal API key

The MCP server signs in with a personal API key. Project keys (`fb_pk_...`) are only for sending data and do not work here.

1. Sign in to the console at [flareboard.dev](https://flareboard.dev).
2. Open the account menu (your name at the bottom of the sidebar), then **API keys**.
3. Click **Create API key**.
4. Enter a **Name**, for example `Claude Desktop`.
5. Under **Scopes**, choose what the key may do:

   | Scope | What it allows |
   | --- | --- |
   | **Read** | View websites, stats and settings. Required for MCP. Enough for every tool except the two that change data. |
   | **Write** | Create, change and delete (everything except GET requests). Adds the `create_annotation` and `toggle_feature_flag` tools. |

6. Click **Create API key**, then copy the key (it starts with `fb_sk_`). Click **Done**.

The key is shown once. Flareboard stores only a hash of it, so a lost key cannot be shown again. Create a new one and revoke the old one with **Revoke** in the same list.

Use a read-only key unless you want the tool to change things. A key acts with your own permissions. Write tools never appear for accounts that have view-only access, even if the key has the **Write** scope. You can have at most 50 keys. A key cannot create or revoke keys. That needs you signed in to the console.

Treat the key like a password. Do not paste it into a chat with an AI tool or commit it to a repository. Put it in the client's config or an environment variable.

## 2. Connect your client

| Setting | Value |
| --- | --- |
| URL | `https://api.flareboard.dev/mcp` |
| Transport | Streamable HTTP. Requests are `POST` and answered as plain JSON. `GET` and `DELETE` answer 405. |
| Authentication | Header `Authorization: Bearer YOUR_API_KEY` |
| Sessions | None. The server is stateless and sends no `Mcp-Session-Id`. |
| Protocol versions | `2025-11-25`, `2025-06-18`, `2025-03-26` |

### Claude Code

```bash
claude mcp add --transport http flareboard https://api.flareboard.dev/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

### Claude Desktop

Claude Desktop connects to remote servers through `mcp-remote`, which runs with `npx`, so Node.js must be installed. Add this to `claude_desktop_config.json`, then restart Claude Desktop:

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

Add this to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project if you only want it there:

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

### Any other client

Point the client at the URL above and send the `Authorization` header on every request. To test the connection without a client, call the server directly:

```bash
curl -s https://api.flareboard.dev/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_websites","arguments":{}}}'
```

The server supports `initialize`, `ping`, `tools/list` and `tools/call`. JSON-RPC batches are not supported.

## 3. Check that it works

Run the `curl` command above. A working key returns a result like this, with your own websites:

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

In a client, ask "List my Flareboard websites". If it names your sites, the connection works.

## Tools

Every tool except `list_websites` takes a `websiteId`. The client gets it from `list_websites`, so you rarely type it yourself.

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_websites` | read | Websites the key can access, with ids, domains and timezones. |
| `run_insight` | read | Runs a trend, funnel or retention insight and returns its numbers. |
| `list_event_names` | read | Custom event names with counts, sessions and property keys. Pageviews are not custom events. |
| `list_property_keys` | read | Event or person property keys, most common first. |
| `list_property_values` | read | Common values of an event property, person property or built-in dimension such as `country`, `browser` or `path`. |
| `get_sql_schema` | read | Tables and columns that `run_sql` can read. Needs the Cloud or Business plan. |
| `run_sql` | read | Runs one read-only `SELECT` on the website's data. Returns the first 100 rows. Needs the Cloud or Business plan. |
| `search_people` | read | People active in a date range, optionally matching an id, email or name. At most 25. |
| `list_error_issues` | read | Error totals and the top error issues, most frequent first. At most 25 issues. |
| `list_feature_flags` | read | Feature flags with state, rollout and variants. Needs the Cloud or Business plan. |
| `evaluate_feature_flag` | read | Evaluates one flag for a distinct id and explains the result. Records no exposure. Needs the Cloud or Business plan. |
| `list_experiments` | read | Experiments with status and current results. Needs the Cloud or Business plan. |
| `create_annotation` | write | Adds an annotation (a dated note on charts) with a `title` and optional `description`, `category` and `happenedAt`. The category is `note`, `release`, `campaign`, `incident` or `experiment`. The action is written to the audit log. |
| `toggle_feature_flag` | write | Turns a flag on or off by `key`. The change is recorded in the flag history. Needs the Cloud or Business plan. |

On Flareboard Cloud, the SQL, feature flag and experiment tools need the Cloud or Business plan. The plan that counts is the one on the website owner's account. On the Free plan these tools answer with an error saying the tool needs a paid plan. All other tools work on every plan. See [Plans and limits](/docs/plans-limits).

### Date ranges

Tools that look at a period take either a `range` or an exact span:

| Parameter | Values | Default |
| --- | --- | --- |
| `range` | `24h`, `7d`, `30d`, `90d`, `180d`, `365d` | `30d` (`7d` for `list_error_issues`) |
| `dateFrom`, `dateTo` | ISO 8601 date or time, in UTC | none |

## Example prompts

Once connected, you can ask things like:

- "List my Flareboard websites and tell me which one has the most visitors in the last 7 days."
- "Which custom events fired on my site in the last 30 days, and which properties do they carry?"
- "Build a funnel from `signup_started` to `signup_completed` for the last 30 days and tell me where people drop off."
- "What are the top error issues this week, and which ones are new?"
- "Show weekly retention for people who triggered `signup_completed`."
- "Which countries send the most traffic to `/pricing`?"
- "Is the `new-checkout` feature flag on, and what would user `user_123` get?"
- "Add an annotation called `v2.4 release` for today." (needs a key with the **Write** scope)

The server tells the model to start with `list_websites`, to discover event names and property keys before building an insight, and to prefer `run_insight` over `run_sql`.

## Limits

| Limit | Value |
| --- | --- |
| Request rate | 120 requests per minute per key. Over the limit you get HTTP 429 with a `Retry-After` header of `60`. |
| Request size | 256 KB. |
| `run_sql` result | 100 rows. Use `COUNT` and `GROUP BY` instead of listing raw rows. |
| `list_event_names` | 100 event names. |
| `search_people` | 25 people. |
| `list_error_issues` | 25 issues. |
| `list_experiments` | 10 experiments. |
| Trend series | At most 62 points per line. Longer series are summarized. |

## Errors

| Response | Meaning |
| --- | --- |
| HTTP 401 | The `Authorization` header is missing, is not a personal key (`fb_sk_...`) or the key does not exist. A deleted account's keys stop working. |
| HTTP 403, "This API key needs the read scope" | The key has no **Read** scope. Create a key with **Read**. |
| HTTP 403, "Origin not allowed" | A browser sent an `Origin` header. The server only accepts browser calls from the Flareboard dashboard origins. Use a desktop client or a server instead. |
| HTTP 429 | More than 120 requests in a minute for this key. |
| Result with `isError: true` | The tool failed: bad input, a website the key cannot access, a missing write permission or a plan that does not include the tool. The message says which. |
| JSON-RPC error `-32602` | The tool name is unknown, or `tools/call` has no tool name or its arguments are not an object. Calling a write tool with a key without **Write** is not a protocol error: it returns `isError: true` saying the tool needs the write scope. |

## Privacy

Whatever a tool returns is sent to the AI tool and provider you chose, under their terms. Results can include event names, page URLs, property values and, for `search_people`, ids, emails and names of people your website recorded. Pick a provider you trust with that data, and see [Privacy and data](/docs/privacy-data). Tool results are data from your visitors, and the server tells the model never to follow instructions found inside them.

## Troubleshooting

- **The client shows no tools.** Check that the key has the **Read** scope and that the URL ends in `/mcp`. Run the `curl` command in step 3 to see the exact error.
- **Write tools are missing.** The key needs the **Write** scope and the account must not be view-only. Create a new key with both scopes and replace the old one.
- **`run_sql` or a flag tool says it needs a paid plan.** The website's owner is on the Free plan. See [Plans and limits](/docs/plans-limits).
- **Claude Desktop does not start the server.** Make sure Node.js is installed so `npx` works, and restart Claude Desktop after editing the config.

## Next steps

- [REST API](/docs/api) for scripts that call Flareboard directly.
- [Set up Flareboard with an AI agent](/docs/ai-agents) to have an agent install tracking in your project.
- [Account security](/docs/security) for session handling and what keys cannot do.
