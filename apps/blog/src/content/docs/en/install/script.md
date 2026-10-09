---
title: Install the tracking script
sidebarTitle: Tracking script
description: Add the Flareboard script tag to your pages, choose its options with data attributes, and allow it in your Content Security Policy.
---

The tracking script is one `<script>` tag. It records pageviews (including single-page app route changes), and optionally autocaptured clicks, errors, web vitals and heatmap samples. Use it on any site where you can edit the HTML. If you build with a JavaScript framework, see [Frameworks](/docs/install/frameworks) for where the tag goes, or use the [npm package](/docs/install/npm).

## Before you start

- A website in Flareboard and its website ID. Open **Websites**, then the website's **Settings**. The **Tracking code** card shows the finished snippet with your ID in it. See the [Quickstart](/docs/quickstart) if you have not added a website yet.
- The examples use Flareboard Cloud (`https://t.flareboard.dev`). If you self-host, replace that address with your own ingest address everywhere.

## 1. Add the tag

Paste this into the `<head>` of every page, replacing `YOUR_WEBSITE_ID`:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

- Use `defer` so the script does not block rendering. The tag runs after the page is parsed.
- Put it on every page you want counted, or in the shared layout or template.
- The script sends data to the origin it was loaded from, so the `src` address is also the ingest address.
- The script file is served with `Cache-Control: public, max-age=86400`, so changes to it can take up to a day to reach browsers.

## 2. Choose options (optional)

Options are `data-*` attributes on the same tag. All are optional. When an attribute is absent, the script follows the website's settings in **Settings**, under **Data collection**.

```html
<script defer src="https://t.flareboard.dev/script.js"
  data-website-id="YOUR_WEBSITE_ID"
  data-environment="production"
  data-release="1.4.2"
  data-autocapture="false"
  data-persistence="false"
  data-respect-dnt></script>
```

| Attribute | Values | Default | What it does |
| --- | --- | --- | --- |
| `data-website-id` | Website UUID | none | Which website receives the data. Required unless you use `data-project-key`. |
| `data-project-key` | Project key starting with `fb_pk_` | none | Use instead of `data-website-id`. The script resolves the website from the key. The key is shown as **Project API key** in the website's **Settings**. |
| `data-autocapture` | `true`, `false` | Website setting (on) | Turns autocapture of clicks, form submits and field changes on or off for pages with this tag. |
| `data-pageleave` | `true`, `false` | Same as autocapture | Sends `$pageleave` events with time on page and scroll depth. |
| `data-persistence` | `false` | Website setting (off) | `false` never keeps an anonymous visitor ID in `localStorage` on this page, even if the website has **Remember visitors across sessions** on. Use it until a visitor consents. |
| `data-respect-dnt` | present, or `false` | Website setting (off) | When present, nothing is sent from browsers with Do Not Track or Global Privacy Control. `data-respect-dnt="false"` turns it off for this page. |
| `data-environment` | Any text | none | A label such as `production`. Attached to errors and logs, and available to feature flag targeting. |
| `data-release` | Any text | none | A version label such as `1.4.2`. Attached to errors and logs, and available to feature flag targeting. |
| `data-heatmap-sample-rate` | Number from 0 to 1 | 0.1 | Share of clicks and scrolls sent for heatmaps. Used until the website's heatmap settings load, which then take over. |

`data-fb-no-capture` goes on page elements, not on the script tag. Autocapture skips that element and everything inside it. The class `ph-no-capture` works the same way. See [Track events](/docs/events#autocapture).

Declarative event attributes (`data-flareboard-event` and its properties) also go on page elements. See [Track events](/docs/events#track-clicks-without-javascript).

Full details for each attribute are in the [Tracker reference](/docs/reference/tracker).

## What the script collects

By default the script records:

- A pageview on load and on every client-side route change.
- `$pageleave` and `$autocapture` events, when autocapture is on. Typed values are never sent.
- JavaScript errors (`window` errors and unhandled promise rejections), for [Error tracking](/docs/error-tracking).
- Web vitals (LCP, INP, CLS, FCP and TTFB), once per page load.
- A sample of clicks and scroll depth for [Heatmaps](/docs/heatmaps).
- Feature flags and surveys configured for the website. See [Feature flags](/docs/feature-flags) and [Surveys](/docs/surveys).

The script sets no cookies. It keeps a session token and a few settings in `sessionStorage`, and an opt-out flag and identified user ID in `localStorage`. The full list is in the [Tracker reference](/docs/reference/tracker#browser-storage).

## Single-page apps

You do not need to call anything for route changes. The script watches `history.pushState`, `history.replaceState`, `popstate` and `hashchange`, and records a new pageview when the page changes. It treats these as a new page:

- A different path, or a different query string.
- A different hash route, such as `#/settings`. A hash that starts with `#/` is read as the page path.

It does not treat in-page anchors such as `#pricing` as new pages. To record a pageview yourself, call `flareboard.page()`.

## Content Security Policy

If your site sends a `Content-Security-Policy` header, allow the ingest address for scripts and for connections:

```text
Content-Security-Policy: script-src 'self' https://t.flareboard.dev; connect-src 'self' https://t.flareboard.dev
```

- `script-src` lets the browser load `script.js`.
- `connect-src` lets the script send events with `fetch` and `navigator.sendBeacon`, and read `/api/tracker-config`.
- If your policy uses nonces, add your `nonce` attribute to the tag. With the npm package, pass the `nonce` option.
- For [Session replay](/docs/session-replay), also allow `https://cdn.jsdelivr.net` in `script-src`, because the rrweb library loads from there.

## Session replay

To record sessions, add two more scripts: the rrweb library and `https://t.flareboard.dev/recorder.js`, which needs the same `data-website-id`. Replay must also be switched on in the website's **Settings**, and on Flareboard Cloud it needs the Cloud or Business plan. The complete snippet and its privacy options are in [Session replay](/docs/session-replay).

## Check that it works

1. Open your site and reload a page.
2. In your browser's developer tools, open the **Network** tab and filter for `script.js`. It should load with status 200.
3. Filter for `send`. A `POST` to `https://t.flareboard.dev/api/send` should return status 200 with JSON containing `cache`, `sessionId` and `visitId`.
4. In the Flareboard console, open **Websites**, then the website's **Settings**, and click **Test tracking**. **Connected**, with **Last event at** and a time, means it works.

If something is missing, see [Troubleshooting](/docs/troubleshooting).

## Next steps

- [Track events](/docs/events) such as sign-ups and purchases.
- [Identify users](/docs/events#identify-users) after sign-in.
- Look up every option and method in the [Tracker reference](/docs/reference/tracker).
