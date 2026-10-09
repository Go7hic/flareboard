---
title: Set up Flareboard with an AI agent
sidebarTitle: AI agents
description: Let Claude Code, Cursor, Codex or another coding agent install Flareboard in your project. A ready-to-paste prompt, what you do yourself, how to verify, and how to query your data afterwards.
---

A coding agent can add Flareboard to your project in a few minutes: it installs the tracking script, adds event calls for sign-up and purchase, and tells you how to check that data arrives. You do the account steps yourself, because they need your login. This page has the steps, a prompt to paste, and the rules the agent should follow.

## What you do yourself

An agent must not create your account or handle your credentials. Do these three things first:

1. **Create an account.** Open [flareboard.dev/register](https://flareboard.dev/register) and sign up with **Continue with GitHub**, or with an email address and password. See the [Quickstart](/docs/quickstart).
2. **Add your website.** In the console, open **Websites**, click **Add website**, enter a **Name** and the **Domain**, and click **Create**.
3. **Copy the website ID.** Flareboard opens the website's settings with the install snippet under **Tracking code**. The website ID is the UUID in `data-website-id`. You give only this ID to the agent.

Never paste a password, a recovery code or a personal API key into a chat with an agent. The website ID is not a secret. It is public in your page source once the script is installed.

## Point the agent at the docs

Every docs page is also plain Markdown, and two index files list them for machines:

| Address | What it is |
| --- | --- |
| `https://flareboard.dev/docs/llms.txt` | A list of every docs page with a one-line description and a link. |
| `https://flareboard.dev/docs/llms-full.txt` | All docs pages in one file. Large: use it when the agent can hold it. |
| Any docs page address plus `.md` | One page as Markdown, for example `https://flareboard.dev/docs/quickstart.md`. |

Tell the agent to start from `llms.txt` and open only the pages it needs. For an install that is usually [Install the tracking script](/docs/install/script), [Frameworks](/docs/install/frameworks) and [Track events](/docs/events).

## Prompt to paste

Replace `YOUR_WEBSITE_ID` with your website ID and paste this into your agent (Claude Code, Cursor, Codex or similar) from the root of your project:

```text
Install Flareboard analytics in this project.

First read https://flareboard.dev/docs/llms.txt. Then read the pages it links for installing the tracking script in this project's framework and for tracking events.

My website ID is YOUR_WEBSITE_ID. The tracker is served from https://t.flareboard.dev/script.js.

Do this:
1. Find out which framework this project uses and where the HTML head or root layout lives.
2. Add the Flareboard script tag to every page, using the website ID above. If the project already has a package manager and a client-side app, you may use the @flareboard/js package instead, as the docs describe.
3. Add flareboard.track() calls for two actions: "signup_completed" when an account is created, and "purchase" when a payment succeeds. Put each call where the success is confirmed, not where the button is clicked. Use short property values such as a plan name.
4. Never send passwords, payment details, email addresses or any other personal data as event properties, and never read form field values.
5. Do not create accounts and do not ask me for passwords or API keys.
6. Run the project's build or type check, show me the diff, and tell me how to confirm with Test tracking in the Flareboard console.
```

If you run your own copy of Flareboard, change `https://t.flareboard.dev` to your own ingest address in the prompt.

## What the agent should end up with

For a plain HTML site, the agent adds this inside `<head>` on every page:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

The script records pageviews, including route changes in single-page apps, so no code is needed for those. For events, the agent calls `track` at the point where something succeeds:

```ts
flareboard.track('signup_completed', { plan: 'free' });
flareboard.track('purchase', { plan: 'pro' });
```

With the script tag, `flareboard` is available as `window.flareboard` once the script has loaded. With the npm package, the agent imports it and calls `init` once, as early as possible:

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev',
  websiteId: 'YOUR_WEBSITE_ID',
});
```

See [npm package](/docs/install/npm) for the full options, and [Track events](/docs/events) for naming, properties and [identifying users](/docs/events#identify-users).

## Rules for agents

If you are an agent reading this page, follow these rules:

- Use the website ID the user gave you. Do not create accounts, do not sign in on the user's behalf and do not ask for passwords or API keys.
- Cloud addresses: dashboard `https://flareboard.dev`, API `https://api.flareboard.dev`, ingest `https://t.flareboard.dev`. A self-hosted install uses its own addresses, so ask the user.
- Never send field values, passwords, card details or other personal data as event names or properties. Autocapture never records what a visitor types, and your own calls must not either.
- Put the script tag in the shared layout so it is on every page, not on one page only.
- Do not invent event names for everything. Add the events the user asked for.
- Run the project's own build or type check before you say you are done.

## Check that it works

1. Deploy the change, or run the site locally and open it in a browser. Click through a few pages, and trigger the sign-up or purchase flow once if you can.
2. In the console, open **Websites**, then the website's **Settings**, and click **Test tracking** next to the snippet.
   - **Connected**, with **Last event at** and a time, means it works.
   - **Waiting for data** means the script is reachable but nothing has arrived in the last 15 minutes. Reload your site and test again.
3. Open **Realtime** for the website to see your visit within a few seconds.

Once you have connected the [MCP server](#query-your-data-with-an-agent), the agent can check this itself: ask it to count today's pageviews with the `run_insight` tool (pageviews use kind `pageview`), and to list custom events with `list_event_names`, where the events it added appear once they have fired. The key stays in the MCP configuration, never in the chat.

Nothing arriving? See [Troubleshooting](/docs/troubleshooting). Common causes are an ad blocker in your own browser, a Content Security Policy that blocks `t.flareboard.dev`, or a wrong website ID.

## Query your data with an agent

Once data is flowing, the same agent can answer questions about it through the [MCP server](/docs/mcp). You create a personal API key yourself in the console (open the account menu, your name at the bottom of the sidebar, then **API keys**), then add it to the agent's MCP configuration, not to the chat or to your code. For Claude Code the setup is one command:

```bash
claude mcp add --transport http flareboard https://api.flareboard.dev/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

Choose only the **Read** scope unless you want the agent to add annotations or turn feature flags on and off. Revoke the key from the **API keys** page when you no longer need it. Config for Claude Desktop, Cursor and other clients is on the [MCP server](/docs/mcp) page.

Then ask in plain language, for example:

- "How many `signup_completed` events did we get in the last 7 days?"
- "Build a funnel from the home page to `signup_completed` and `purchase`."
- "What are the top error issues this week?"

For scripts that call Flareboard directly, see the [REST API](/docs/api).

## Troubleshooting

- **The agent added the tag but nothing arrives.** Check that the website ID in the tag matches the one in the console, and that the tag is on the pages you visit. Frameworks with several layouts need the tag in each one.
- **The agent used the wrong address.** The script is served from the ingest address (`https://t.flareboard.dev` on Cloud), not from `flareboard.dev` or the API address.
- **The agent cannot reach the docs.** Paste the page content into the chat, or give it the `.md` address of the page.
- **Events show up but are empty or noisy.** Ask the agent to track only the events you named, and read [Track events](/docs/events) for property guidance.
