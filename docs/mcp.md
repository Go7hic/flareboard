# MCP server and the Ask Flareboard assistant

Flareboard exposes its analytics to AI tools in two ways that share one tool registry
(`apps/api/src/lib/ai-tools.ts`):

- **MCP server** at `https://<api-host>/mcp` for Claude Desktop, Claude Code, Cursor and any other
  [Model Context Protocol](https://modelcontextprotocol.io) client.
- **Ask Flareboard**, a side panel in the dashboard (per website) that answers questions with Claude,
  using the read-only tools.

## MCP server

| | |
|---|---|
| Endpoint | `POST /mcp` (Streamable HTTP, JSON responses; `GET`/`DELETE` answer 405) |
| Protocol versions | `2025-11-25`, `2025-06-18`, `2025-03-26` |
| Auth | `Authorization: Bearer fb_sk_…` (a personal API key, created under **API keys** in the dashboard) |
| Sessions | Stateless: no `Mcp-Session-Id` |
| Rate limit | 120 requests per minute per key (HTTP 429 with `Retry-After`) |

The key needs the **read** scope. Write tools are listed only for keys that also have **write**, and
never for view-only accounts. Every call is checked against the websites the key's user can access,
write permission on that website, and (hosted mode) the plan features of the website's owner
(warehouse for SQL, experimentation for flags and experiments).

### Tools

| Tool | Scope | What it does |
|------|-------|--------------|
| `list_websites` | read | Websites the key can access, with ids and timezones |
| `run_insight` | read | Trend, funnel or retention insight from an insight query (v2, validated like saved insights) |
| `list_event_names` | read | Custom event names with counts and property keys |
| `list_property_keys` | read | Event or person property keys |
| `list_property_values` | read | Common values of a property or built-in dimension |
| `get_sql_schema` | read | Tables and columns `run_sql` can read |
| `run_sql` | read | One read-only SELECT with the warehouse guards (scoped to the website, row and time caps; first 100 rows returned) |
| `search_people` | read | People active in a range, optionally matching id, email or name (max 25) |
| `list_error_issues` | read | Error totals and top issues |
| `list_feature_flags` | read | Flags with state, rollout and variants |
| `evaluate_feature_flag` | read | Evaluates one flag for a distinct id (no exposure recorded) |
| `list_experiments` | read | Experiments with their current results |
| `create_annotation` | write | Adds an annotation (audit-logged) |
| `toggle_feature_flag` | write | Turns a flag on or off (recorded in the flag history) |

Dates: tools take `range` (`24h`, `7d`, `30d`, `90d`, `180d`, `365d`; default `30d`) or
`dateFrom`/`dateTo` (ISO 8601, UTC). Tool failures (bad input, no access) come back as results with
`isError: true`; unknown tools are JSON-RPC errors (`-32602`).

### Claude Desktop

`claude_desktop_config.json` (Claude Desktop connects to remote servers through `mcp-remote`):

```json
{
  "mcpServers": {
    "flareboard": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.your-domain.com/mcp",
        "--header",
        "Authorization:${FLAREBOARD_AUTH}"
      ],
      "env": { "FLAREBOARD_AUTH": "Bearer fb_sk_..." }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http flareboard https://api.your-domain.com/mcp \
  --header "Authorization: Bearer fb_sk_..."
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "flareboard": {
      "url": "https://api.your-domain.com/mcp",
      "headers": { "Authorization": "Bearer fb_sk_..." }
    }
  }
}
```

Use a read-only key unless you want the tool to create annotations or toggle flags. Revoking the key
in the dashboard cuts access immediately.

### Raw requests

```bash
curl -s https://api.your-domain.com/mcp \
  -H "Authorization: Bearer fb_sk_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_websites","arguments":{}}}'
```

## Ask Flareboard (dashboard assistant)

Set the `DEEPSEEK_API_KEY` secret on the API worker to turn it on
(`wrangler secret put DEEPSEEK_API_KEY --env production`; locally in `apps/api/.dev.vars`). Without it
the button is hidden and the endpoints answer 404; the MCP server works either way. Optional vars:
`DEEPSEEK_MODEL` (default `deepseek-flash`; `deepseek-v4-pro` for harder questions) and
`DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/anthropic`).

- DeepSeek through its Anthropic-format Messages endpoint (`fetch`, streaming, thinking mode on),
  with the read-only tools above minus `list_websites`, bound to the current website. Write tools are
  never offered to the assistant.
- Up to 8 model requests per answer. Tool results sent to the model are capped (100 rows, 12,000
  characters, long trend series summarized). Tool errors go back to the model as tool results whose
  text starts with `Error:` (DeepSeek ignores `is_error`).
- DeepSeek rejects earlier assistant turns sent without their reasoning when tools are present, so
  earlier messages are folded into the question as a plain-text transcript; within one answer the
  tool loop echoes the model's thinking blocks back unchanged.
- Data goes to DeepSeek (Hangzhou DeepSeek Artificial Intelligence Co., Ltd.), stored in China and
  possibly used to improve its models; the Privacy Policy says so (`#assistant`).
- Conversations are stored per user and website (`ai_conversation`, `ai_message`; migration 0056):
  50 conversations per website, 100 messages each, the last 12 messages sent with a new question,
  deleted after 90 days idle (hourly cron) and with the website or account.
- Limits: 10 questions per minute per user; in hosted mode a daily cap per account by the website
  owner's plan (`ASSISTANT_DAILY_LIMITS` in `apps/api/src/lib/assistant.ts`, counted in `ai_usage_daily`).
- Nothing about questions or answers is logged. View-only users can use the assistant.

API (session auth):

| Method | Path | |
|--------|------|---|
| GET | `/api/websites/:websiteId/assistant` | `{ enabled, usage }` |
| GET | `/api/websites/:websiteId/assistant/conversations` | the caller's conversations |
| GET | `/api/websites/:websiteId/assistant/conversations/:id` | messages |
| DELETE | `/api/websites/:websiteId/assistant/conversations/:id` | delete |
| POST | `/api/websites/:websiteId/assistant/messages` | `{ message, conversationId? }` → `text/event-stream` of `AiStreamEvent` (`packages/shared/src/ai.ts`) |
