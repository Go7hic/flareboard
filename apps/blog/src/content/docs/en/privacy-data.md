---
title: Privacy and data
description: What Flareboard collects and what it never does, how visitors are counted without cookies or stored IP addresses, session replay masking, where data lives, how long it is kept, how to export or delete it, and the AI assistant disclosure.
---

Flareboard is built to measure websites without cookies and without storing IP addresses. This page explains what that means in practice, which settings change it, where your data is stored and how to get it out or have it deleted. It describes how the product works. It is not legal advice, and it does not replace the [Privacy Policy](https://flareboard.dev/privacy) or the [Terms of Service](https://flareboard.dev/terms), which are the binding documents for Flareboard Cloud.

On a self-hosted install, you run everything on your own Cloudflare account and decide how data is handled. The Flareboard service has no access to that data.

## Your role and ours

For the data your websites collect about their visitors, you decide to install Flareboard and what to collect, so you are the controller. Flareboard processes that data only to provide the service, as your processor. See [Data processing](https://flareboard.dev/terms#data-processing) in the Terms. For your own account details, Flareboard is the controller. If a visitor to your site asks to exercise privacy rights, they contact you first.

## Cookies and browser storage

The tracking script sets **no cookies**. By default it keeps short-lived session information in `sessionStorage`, which the browser clears when the tab closes. It uses `localStorage` only in these cases:

| When | What is stored |
| --- | --- |
| You call `identify()` for a signed-in user | The identifier you pass, so later events connect to that user. |
| A survey is shown | The survey's state, so it is not shown again too soon. |
| A visitor opts out | The choice to opt out. |
| The website remembers visitors (off by default) | A random visitor id, and any event properties you register for every event. |

The Flareboard console itself uses one cookie, `flareboard_session`, to keep you signed in. It is HttpOnly and Secure and expires 7 days after it was last renewed.

## IP addresses

Flareboard never stores IP addresses. The service reads the IP address of a request to work out the visitor hash described below and an approximate location (country, region and city), and for brief rate limiting, and then discards it. Sign-in records and the audit log do not include IP addresses either. The hosting provider's technical request logs can contain IP addresses and are deleted automatically, typically within 7 days. The full browser user agent is not stored. Only a coarse browser, operating system and device type is kept.

Events sent with PostHog SDKs are handled the same way. IP address properties and raw user agent strings in that data are discarded, not stored.

## How visitors are counted

To count unique visitors without cookies, Flareboard computes a one-way hash of the IP address, user agent, website and a secret value. The secret value changes at the start of each calendar month. The same browser on the same network counts as one visitor within a month, and cannot be linked from one month to the next.

### Remember visitors across sessions (opt-in)

If you want returning visitors recognized across months and networks, turn on the website's **Remember visitors across sessions** setting. Open **Websites**, then the website's **Settings**, and find **Data collection**. The script then keeps a random id in the visitor's `localStorage` and uses it instead of the monthly hash. The id is random. It is not derived from the IP address or the device. IP addresses are still not stored.

This puts an identifier on the visitor's device, so depending on where your visitors are, you may need their consent first. Leave the setting off to keep Flareboard cookieless. You can also keep a single page cookieless with `data-persistence="false"` on the script tag, for example until a visitor consents.

### Do Not Track and opt-out

- Turn on **Honor Do Not Track and Global Privacy Control** in the same **Data collection** card. Browsers that send either signal are then not tracked at all.
- You can offer visitors an opt-out with `flareboard.optOut()`, `flareboard.optIn()` and `flareboard.hasOptedOut()`. The choice is remembered in the browser. Neither the tracking script nor the session recorder sends anything for an opted-out visitor.
- The script ignores most automated traffic, such as bots and crawlers.

## What autocapture never collects

Autocapture records clicks on links and buttons, form submits and field changes, plus time on page and scroll depth. You can turn it off with **Autocapture clicks, form submits and page leaves** in **Data collection**. It follows these rules:

- It never records what a visitor types or selects in a form field.
- It never reads text from form fields, password fields or elements that look sensitive, such as payment or one-time-code fields.
- It drops text that looks like a card number, an identity number or an email address.
- It records nothing inside parts of a page you mark as excluded, with `data-fb-no-capture` or the class `ph-no-capture` on an element.
- For each interaction it records the kind of element, its id, name and classes, the link address, a short description of where it sits in the page and up to 255 characters of its visible text.

Because visible text is captured, do not put personal data in link or button text.

## Session replay masking

Session replay is off by default and needs the Cloud or Business plan. When you turn it on under **Session replay** in the website's settings, the **Privacy** step controls what is recorded:

| Setting | Effect |
| --- | --- |
| **Mask all input fields** | On by default. Everything typed into form fields is masked. Password, payment-card and one-time-code fields and fields that look sensitive stay masked even when this is off. |
| **Mask all text on the page** | Masks all text on the page. |
| **Mask selectors (CSS)** | Replaces text and inputs inside matching elements. `[data-fb-mask]`, `.fb-mask` and `.ph-mask` always apply. |
| **Block selectors (CSS)** | Replaces matching elements with an empty box of the same size. `[data-fb-no-capture]`, `.ph-no-capture`, `[data-fb-block]`, `.fb-block` and `.ph-block` are always blocked. |
| **Sample rate** | The share of sessions recorded. |
| **Minimum visit duration** | Shorter visits send nothing. |
| **Capture console logs** | Off by default. Stores the level and message (up to 1,000 characters) of console calls and uncaught errors. Email addresses, card-like numbers, tokens, values labeled as passwords or secrets and URL query strings are removed first. |
| **Capture network requests** | Off by default. Stores method, address without the query string, status, duration and size. Headers and bodies are never recorded. |

Text shown on the page is recorded unless it is masked, so configure replay not to capture sensitive information on your pages. Nothing is recorded for visitors who opted out or who send Do Not Track or Global Privacy Control when you honor those signals. See [Session replay](/docs/session-replay).

## What you send yourself

Custom events, `identify()` calls, group data, revenue values, errors, logs and survey answers contain whatever your code or your visitors put in them. Flareboard does not filter them for personal data. Use an internal user id rather than an email address, and never send passwords, card details or other secrets. See [Track events](/docs/events).

## Where your data is stored

Flareboard Cloud runs on Cloudflare. Your data is stored in these places:

| Data | Where |
| --- | --- |
| Analytics events, sessions, people and logs for a website | A SQLite Durable Object per website, so each website's data sits in its own store |
| Accounts, teams, website settings, boards, flags and other configuration | Cloudflare D1 |
| Session replay recordings and uploaded source maps | Cloudflare R2 |

Cloudflare runs a global network, so data can be processed in data centers in many countries. For the list of providers Flareboard shares data with and the safeguards for transfers, see the [Privacy Policy](https://flareboard.dev/privacy). Cloud uses Cloudflare for hosting and email delivery, Stripe for payments, Google and GitHub for optional sign-in, and DeepSeek for the AI assistant when you use it.

## Retention and deletion

| Data | How long it is kept |
| --- | --- |
| Raw events and session replays | For the website's retention period, then deleted automatically. You can set it per website, up to the plan maximum: 365 days on Free, 730 on Cloud and 1,095 on Business. When none is set, the plan maximum applies. |
| Aggregated statistics derived from raw events | May be kept for the life of the website. |
| Logs and traces | 30 days, or less if the website's retention is shorter. |
| Assistant conversations | Until you delete them, and removed after 90 days without activity. |
| Sign-in records | 180 days. |
| Deleted websites and accounts | Removed immediately from your account, then permanently erased after 30 days. |
| Database backups | Deleted data can stay in backups for up to 30 days. |

To set a shorter retention, open the website's **Settings**, find **Data retention** and fill in **Keep raw data for (days)**. See [Plans and limits](/docs/plans-limits).

To delete a website, open its **Settings** and use **Delete website**. All of its stored data, including replay recordings and stored API keys, is erased within 30 days. To delete your account and everything in it, see [Account security](/docs/security#delete-your-account). Until the 30 days pass the data still exists, so if you deleted something by mistake, email [support@flareboard.dev](mailto:support@flareboard.dev) straight away.

## Export your data

On the Cloud and Business plans you can download your data as CSV. Self-hosted installs have no plan limits on this.

- **Events and pageviews.** On the website's **Overview**, use **Export** and choose **Events** or **Browsing** (pageviews). The export covers the date range you have selected, up to the newest 10,000 rows. The same export is available from the API: see [REST API](/docs/api#export-csv).
- **Query results.** On the website's warehouse page, run a read-only SQL query and click **Export CSV**.

Exports of events and pageviews are recorded in the website's audit log.

## AI assistant and MCP

"Ask Flareboard" is an assistant in the dashboard that answers questions about a website's analytics. It runs only when you send it a question, and only if the operator of your install has turned it on. When you use it:

- Flareboard sends your question, up to the last 12 messages of the conversation, the website's name, domain and timezone, and the results of the read-only queries the assistant runs to Hangzhou DeepSeek Artificial Intelligence Co., Ltd. Results are limited to 100 rows per query and a capped number of characters. They can include event names, page URLs, property values and, when a question needs it, the ids, emails or names of people your website recorded.
- DeepSeek stores this data on servers in China. Under DeepSeek's own terms it may keep inputs and outputs and use them to improve its models.
- Flareboard stores your questions and answers in your account, visible only to you, and does not write them to its logs.
- If you or your visitors are subject to rules that restrict transfers to China, do not use the assistant, and do not ask it questions whose results you would not share with DeepSeek.

Data that AI tools read through the [MCP server](/docs/mcp) goes to the tool and provider you chose, under their terms. Changes made through MCP, such as annotations and feature flag toggles, are recorded in the audit log.

## Consent banners

Whether your site needs a consent banner depends on the law that applies to you and your visitors, and on how you use Flareboard. Flareboard's defaults set no cookies and store no IP addresses. Whether that is enough for your site is a decision for you and your legal adviser, and this page does not make it for you. These settings are the ones that most change the answer:

- **Remember visitors across sessions** stores an identifier on the visitor's device.
- `identify()` stores the id you pass in the visitor's browser and links their activity to a person.
- **Session replay** records what visitors see and do on your pages.
- Event properties, user ids and survey answers can contain personal data that you choose to send.

To collect nothing until a visitor agrees, load the script only after consent, or use `data-persistence="false"` for the identifier and `flareboard.optOut()` for opt-out. If you use the [npm package](/docs/install/npm), set `persistence: false`.

## Troubleshooting

- **A visitor is counted twice in a month.** The monthly hash includes the IP address and user agent, so the same person on a different network or browser is a different visitor. This is by design. **Remember visitors across sessions** changes it, with the consent trade-off above.
- **Sensitive text appears in a replay.** Add the element to **Mask selectors (CSS)** or **Block selectors (CSS)**, or turn on **Mask all text on the page**, then check a new recording.
- **You need one person's data removed.** Visitor data is tied to the website, not to an account. Email [support@flareboard.dev](mailto:support@flareboard.dev) with the website and the visitor's id. Deleting the website removes all of its data.
