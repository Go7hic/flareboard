---
title: Troubleshooting
description: Find out why no data arrives in Flareboard, why events or pages are missing, and how to read the tracker's network requests.
---

Start with the browser's network requests. They show within a minute whether the script loaded, whether it sent data, and what ingest answered. The sections below cover the usual causes in the order to check them.

## Look at the network requests

1. Open your site in a browser and open the developer tools.
2. Open the **Network** tab and reload the page. Filter for `script.js`, then for `send`.
3. Compare what you see with this table. The ingest address is `https://t.flareboard.dev` on Flareboard Cloud, or your own address if you self-host.

| Request | Expected | Meaning |
| --- | --- | --- |
| `GET /script.js` | Status 200, JavaScript | The tracker loaded. |
| `GET /api/tracker-config?website=YOUR_WEBSITE_ID` | Status 200, JSON | The website's settings loaded. The script caches this for 60 seconds in `sessionStorage`, so it may be missing on a quick reload. |
| `POST /api/send` | Status 200, JSON with `cache`, `sessionId` and `visitId` | A pageview or event was accepted. |

The request body of `POST /api/send` is JSON sent as `text/plain`. It looks like `{"type":"event","payload":{"website":"...","url":"/pricing",...}}`. An event adds `"name"` and `"data"` to the payload.

What the status of `POST /api/send` means:

| Response | Cause | Fix |
| --- | --- | --- |
| 200 with `{"cache":...}` | Accepted. | Nothing to fix. If the dashboard stays empty, check the website you are viewing. |
| 200 with `{"beep":"boop"}` | The request's user agent looks like a bot or crawler, so it was ignored. | Test from a normal browser. See [Bots](#bots-are-ignored). |
| 400 with `Website not found.` | The website ID does not exist, or the website was deleted. | Copy the ID again from the website's **Settings**. |
| 400 with another message | The payload failed validation: an invalid website ID, an event name over 50 characters, more than 100 properties, or a body over 64 KB. | Read the `message` in the response and fix the call. |
| 402 | On Flareboard Cloud, the account's monthly event allowance is used up (`Monthly event limit exceeded.`). | See [Plans and limits](/docs/plans-limits). |
| 429 | More than 100 requests per minute from one IP address for one website. | Slow the sender. |

The console also helps. The script writes warnings that start with `[flareboard]`:

- `[flareboard] missing data-website-id`: the tag has no website ID.
- `[flareboard] send failed`: a request failed or returned an error status (for example `Error: send 400`). The response body is in the Network tab.
- `[flareboard] could not resolve data-project-key`: the project key is unknown.

In the browser console, type `window.flareboard`. It should be an object. `undefined` means the script did not load or run.

## No data arrives

### `script.js` is not requested, or it is blocked

- **The tag is missing from the page.** View the page source and look for the `<script>` tag with `src` ending in `/script.js`. Check that it is in the rendered HTML of the page you opened, not just in a template.
- **An ad blocker or privacy extension blocks it.** The request shows as blocked or failed in the Network tab, and `window.flareboard` is undefined. Turn the blocker off for your own site to confirm. Visitors with blockers will not be counted. The script sends events to the address it was loaded from, so serving it from your own domain changes the address that blockers see. That needs your own forwarding to the ingest worker for `/script.js` and the `/api/*` paths the script calls (`/api/send`, `/api/tracker-config`, `/api/feature-flags/evaluate`, `/api/surveys/response`, and `/api/record` for replay).
- **A Content Security Policy blocks it.** The console shows a message that the script or connection was refused by the policy. Allow the ingest address in `script-src` and `connect-src`. See [Content Security Policy](/docs/install/script#content-security-policy).
- **A typo in the address.** The `src` must be `https://t.flareboard.dev/script.js` on Cloud, or your own ingest address.

### The script loads but nothing is sent

- **Do Not Track or Global Privacy Control.** If the website has **Honor Do Not Track and Global Privacy Control** on, or the tag has `data-respect-dnt`, the script sends nothing from browsers that send either signal. Browsers and privacy extensions can send either signal. In the browser console, `flareboard.hasOptedOut()` returns `true` in this case. Test in a window without the signal, or turn the setting off in **Settings**, under **Data collection**. `data-respect-dnt="false"` on the tag turns it off for a page.
- **The visitor opted out.** If your code or a consent banner called `flareboard.optOut()` in this browser, nothing is sent until `flareboard.optIn()`. The choice is stored in `localStorage` as `flareboard.opt_out`.
- **A wrong or missing website ID.** The console warns `missing data-website-id`. A wrong ID gives a 400 from `POST /api/send`.
- **A project key that does not resolve.** With `data-project-key`, the script first requests `/api/tracker-config?key=...`. If that fails, it sends nothing and logs `could not resolve data-project-key`.

### Requests are sent but the dashboard is empty

- **The wrong website.** Check that the website ID in the tag is the one you are viewing.
- **A bot user agent.** A `200` with `{"beep":"boop"}` means the request was ignored. See [Bots](#bots-are-ignored).
- **The date range.** Check the range selected in the dashboard. **Realtime** shows the last few minutes.
- **Rate limit or plan limit.** Look for a 402 or 429 status above.

Use **Test tracking** in the website's **Settings**, under **Tracking code**, to check from Flareboard's side. **Connected**, with **Last event at** and a time, means events arrived in the last 15 minutes. **Could not load the tracker script from the ingest URL.** means the script address cannot be reached.

### Domain mismatch

Flareboard does not compare the page's hostname with the **Domain** you entered when you added the website. Any page that sends a valid website ID is recorded under that website, whatever its domain. A domain mismatch is not a reason for missing data. The hostname is stored with each event.

### Localhost and development

Neither the script nor the ingest worker treats `localhost` or any other host differently. Visits from your development machine are recorded like real ones, with the hostname `localhost`, and count toward your plan. To keep them out of your real numbers, add a separate website for development and use its ID in your dev environment. `data-environment` is a label for errors, logs and feature flag targeting. It does not filter pageviews.

### Bots are ignored

Ingest checks the `User-Agent` header of each request and ignores traffic from crawlers and other automated browsers. It answers `200` with `{"beep":"boop"}` and records nothing. Tools like `curl`, `node`, `python-requests` and other HTTP libraries are not treated as bots, so they work for server-side sends and for testing.

## Events are missing

- **The event name is longer than 50 characters.** The whole request fails with a 400. Shorten the name.
- **More than 100 properties.** The request fails with a 400. Send fewer properties.
- **Nested properties are gone.** Objects and arrays inside `data` are dropped. Only strings, numbers and booleans are stored. Flatten them: `{ plan: 'pro' }` rather than `{ account: { plan: 'pro' } }`.
- **The call ran before the script loaded.** With the script tag, an inline `flareboard.track()` call runs before the deferred script and fails with `flareboard is not defined`. Use the npm package, call it after load, or push to the queue. See [Track events](/docs/events#calling-before-the-script-has-loaded).
- **Autocapture events are missing.** Check that **Autocapture clicks, form submits and page leaves** is on, that the tag does not have `data-autocapture="false"`, and that the element is not inside `data-fb-no-capture`. Autocapture drops repeats of the same element within one second and caps each page at a burst of 10 and 100 in total.
- **Clicks on a declarative event do nothing.** The attribute must be `data-flareboard-event` (or `data-umami-event`) on the element or an ancestor of what was clicked.
- **Sign-in attribution is wrong.** Events before `identify` are anonymous. Call `flareboard.identify()` after sign-in, and `flareboard.reset()` after sign-out. See [Identify users](/docs/events#identify-users).

## Single-page app pages are not counted

The script records a new pageview when the History API or the hash changes: `pushState`, `replaceState`, `popstate` and `hashchange`.

- **A route change that changes only an in-page anchor** such as `#pricing` is not a new page. Hash routes that start with `#/` are counted.
- **A `replaceState` to the same address** is not a new page. A change to the query string alone is.
- **The router does not use the History API or a hash route.** Call `flareboard.page()` after each navigation.
- **The title is old.** The script reads `document.title` at the moment of the route change. If your framework updates the title a moment later, the pageview carries the previous title.
- **The script loaded only on some pages.** For a site that mixes server-rendered pages and an app, make sure the tag is in every layout.

## Duplicate pageviews

Every pageview doubles when the tracker is loaded twice. Common causes are the script tag plus the npm package (see [Install with npm](/docs/install/npm#use-the-package-or-the-script-tag-not-both)), or the tag placed in both a layout and a page. Look for two `script.js` requests in the Network tab.

## Test from the command line

This sends one pageview from a terminal and shows what ingest answers. Replace `YOUR_WEBSITE_ID`:

```bash
curl -i -X POST https://t.flareboard.dev/api/send \
  -H 'Content-Type: application/json' \
  -d '{"type":"event","payload":{"website":"YOUR_WEBSITE_ID","hostname":"example.com","url":"/curl-test","title":"curl test"}}'
```

A working setup returns `HTTP/2 200` and a body like `{"cache":"...","sessionId":"...","visitId":"..."}`. The visit then shows in **Realtime**. It counts as one event toward your plan. A `400` body tells you what is wrong with the ID or payload.

## Still stuck

Email [support@flareboard.dev](mailto:support@flareboard.dev) with the website ID, the page address, and the status and response body of the `POST /api/send` request. Or open an issue on [GitHub](https://github.com/Go7hic/flareboard/issues).
