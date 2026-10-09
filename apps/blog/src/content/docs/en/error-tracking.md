---
title: Error tracking
description: Capture uncaught JavaScript errors and your own handled exceptions, group them into issues by stack trace, read readable stacks with source maps, and get alerted when errors spike or come back.
---

The tracking script reports uncaught errors and unhandled promise rejections on its own. Flareboard groups the occurrences into issues, lets you resolve or ignore them, and links each occurrence to the session where it happened. Add source maps and stack traces show your original code instead of minified bundles.

Error tracking is available on every plan.

## Before you start

- Install the [tracking script](/docs/install/script) or the [npm package](/docs/install/npm) on the pages you want to watch.
- Set a release and an environment so you can tell versions apart and match source maps. See [Set a release and environment](#1-set-a-release-and-environment).
- To edit issues, upload source maps or create alerts, use an account that can edit the website. View-only accounts can read everything.

## What is captured

Without any code, the script sends:

- uncaught errors raised on the page (`window` `error` events), with the message, error name, stack (up to 12,000 characters), source file, line and column;
- unhandled promise rejections (`unhandledrejection`), with the reason's message, name and stack.

Both are stored with `handled: false` and the severity `error`. Failed loads of images, scripts or styles are not reported. Nothing is sent from browsers where the visitor opted out, or where Do Not Track is honored. See [Privacy and data](/docs/privacy-data) for how consent and opt-out work.

Errors from [PostHog SDKs](/docs/install/posthog) also arrive: a PostHog `$exception` event is stored as an error.

Messages and stack traces are stored as they are sent. Keep emails, tokens and other personal data out of error messages and out of the `data` you attach.

## 1. Set a release and environment

Add `data-release` and `data-environment` to the script tag. Use a value that changes with every deploy, such as the git commit, as the release.

```html
<script
  defer
  src="https://t.flareboard.dev/script.js"
  data-website-id="YOUR_WEBSITE_ID"
  data-release="YOUR_RELEASE"
  data-environment="production"
></script>
```

With the npm package, pass `release` and `environment` to `flareboard.init()` instead. Self-hosters replace `t.flareboard.dev` with their own ingest address.

A release can be up to 200 characters and an environment up to 100. Ingest rejects events with longer values.

The release and environment travel with every event, error and log the script sends. They fill the **All releases** and **All environments** filters on the **Errors** page, and they select which source maps are used.

## 2. Capture an error yourself

Use `captureException` for errors you catch, such as a failed checkout request.

```ts
import { flareboard } from '@flareboard/js';

try {
  await submitOrder();
} catch (error) {
  flareboard.captureException(error, {
    severity: 'warning',
    data: { step: 'payment' },
  });
}
```

With the script tag, call `window.flareboard.captureException(error, context)`. The second argument is optional.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `severity` | `'fatal'`, `'error'`, `'warning'` or `'info'` | `'error'` | How serious the error is. Alerts can filter on it. |
| `handled` | boolean | `true` | `true` for errors you caught, `false` for ones that escaped. |
| `release` | string | `data-release` | Overrides the release for this error. |
| `environment` | string | `data-environment` | Overrides the environment for this error. |
| `data` | object | none | Extra properties stored with the error. |

You can pass an `Error`, or a string. Calls made before the script has loaded are queued by the npm package and sent once it is ready.

## 3. How errors are grouped into issues

Every occurrence gets a fingerprint, and occurrences with the same fingerprint form one issue. The issue page says how it was grouped.

1. A custom fingerprint wins. You set `$exception_fingerprint` in `data` to a string, or to an array of strings and numbers (up to 500 characters in total).
2. Otherwise Flareboard groups by the error type plus up to five frames from your own code. It ignores built-in frames, browser extensions, `node_modules`, `vendor` folders, bundler vendor chunks, common library files and well-known third-party hosts. File paths and function names are normalized so build hashes and numbers do not split an issue.
3. When there is no usable stack, it groups by the error type and the message. Ids, numbers, UUIDs, emails, hex values and quoted values in the message are replaced before grouping.

To force two different failures into one issue, or to keep one apart, set your own fingerprint:

```ts
flareboard.captureException(error, {
  data: { $exception_fingerprint: 'checkout-payment-declined' },
});
```

You can also merge issues afterwards. On the **Errors** page, tick two or more issues, choose the target under **Merge into** and click **Merge**. Their events, including future ones, count toward the target. The target keeps its status, assignee and comments. On the target issue's page, click **Unmerge** next to the issue under **Merged issues** to split it out again.

## 4. Work through issues

Open your website, then **Errors** in the sidebar.

- The tiles show **Error issues**, **Occurrences**, **Affected sessions** and **Error-free sessions** for the date range you pick.
- **Error issues** lists the 25 most frequent issues with their status, **Occurrences**, **Users** and **Last seen**. Click one to open it.
- **Recent errors** lists individual occurrences. Click one to see its properties, resolved stack and a **View session** link.
- Filter by status (**Open** is the default, then **Regressed**, **Resolved**, **Ignored** and **All statuses**), by **All releases** and by **All environments**.

An issue has one of these statuses.

| Status | Meaning |
| --- | --- |
| **Open** | New or reopened, still to be handled. |
| **Resolved** | You fixed it. Click **Resolve** in the row's menu. |
| **Ignored** | You decided not to act on it. Click **Ignore**. |
| **Regressed** | A resolved issue occurred again. Flareboard sets this itself. |

Use **Reopen**, **Resolve** or **Ignore** in the row's menu to change a status. An issue page also has a **Stack trace** of the latest occurrence, **Comments** for your team, **Recent occurrences**, and the issue's **Fingerprint**.

### Regressions

When a resolved issue occurs again after you resolved it, it becomes **Regressed**. The issue page keeps a **Regression history** with when it was resolved, when it occurred again, and whether an alert was sent. Flareboard notices a regression when the new error arrives, when the issues list loads, and in an hourly sweep.

## 5. Read original code with source maps

Browsers report positions in the minified file. A source map lets Flareboard show the file, line and surrounding code from your source.

1. Build your app with source maps turned on.
2. Set `data-release` to the release you will upload for, as in [step 1](#1-set-a-release-and-environment).
3. Upload each `.map` file under that release, in the console or from CI.

### Upload from the console

1. Open **Errors**, then **Source maps**.
2. Click **Upload**.
3. Enter the **Release** (for example `storefront@3.40.0`), the **File path** (for example `assets/app.js.map`) and the **Source map JSON**, then click **Upload source map**.

The same panel lists uploaded maps, filtered by the release you chose on the page, and lets you delete them.

### Upload from CI

Create a personal API key under **API keys** with the **Write** scope, then send the maps as `multipart/form-data`. The filename of each part is the path the map is stored under, normally the script's path in your site plus `.map`.

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/errors/source-maps \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F release=YOUR_RELEASE \
  -F "file=@dist/assets/index-C3sPvF1q.js.map;filename=assets/index-C3sPvF1q.js.map"
```

The answer is `201` with the release and a `sourceMaps` list that holds each map's `id`, `file`, `size` and timestamps. Repeat `-F "file=@...;filename=..."` for more maps, up to 100 per request. Self-hosters replace `api.flareboard.dev` with their own API address.

| Rule | Detail |
| --- | --- |
| Format | A JSON source map, version 3. Indexed maps (with `sections`) are refused, so upload one map per file. |
| Size | Up to 20 MB per map. |
| Replacing | Uploading the same release and file again replaces the map. |
| JSON upload | You can also `POST` `{"release": "...", "file": "...", "content": "..."}` as JSON, up to 5 million characters of content. It answers `201` with the map. |
| List and delete | `GET /api/websites/YOUR_WEBSITE_ID/errors/source-maps?release=YOUR_RELEASE`, and `DELETE /api/websites/YOUR_WEBSITE_ID/errors/source-maps/SOURCE_MAP_ID`. |

### How maps are matched

Flareboard reads the script path from each stack frame (the URL without origin, query string or fragment) and looks for a map of that release. For `https://example.com/assets/index-C3sPvF1q.js` it looks for a map stored as `assets/index-C3sPvF1q.js.map`, `assets/index-C3sPvF1q.js`, `index-C3sPvF1q.js.map` or `index-C3sPvF1q.js`, in that order. An error without a release is still matched when the file name carries a content hash, which makes the match unambiguous.

Frames that have a map show the original file, line and column, and the lines around it when the map includes `sourcesContent`. Frames without one stay minified. The latest occurrence on an issue page and the **Resolved stack** on an error page use the maps.

## 6. Get alerted

1. Open **Errors**, then **Alerts**.
2. Click **New rule** and then fill in the form.
3. Click **Create alert rule**.

| Field | What it does |
| --- | --- |
| **Rule name** | A label for the rule. |
| **Threshold** | The number of errors that triggers the rule, 1 to 100,000. |
| **Window (minutes)** | The period the errors are counted over, 1 to 10,080. |
| **Severity**, **Release**, **Environment** | Optional filters. Leave them on **All** or **Any** to count everything. |
| **Channel** | **Record only** stores the alert in Flareboard. **Email** and **Webhook** also notify. |
| **Target** | The email address, or the webhook URL. |
| **Also notify when a resolved issue occurs again** | Sends a message when an issue becomes **Regressed** and the occurrence matches the rule's severity, release and environment filters, through the rule's email or webhook. |

Rules are checked once an hour. A rule fires when it finds at least the threshold of matching errors in the last window, and it will not fire again until a full window has passed. A rule with a short window can therefore miss a burst that falls between two checks.

Webhooks receive a JSON `POST`. An alert looks like this:

```json
{
  "type": "error_alert",
  "websiteId": "YOUR_WEBSITE_ID",
  "ruleName": "Checkout errors",
  "count": 42,
  "threshold": 20,
  "windowMinutes": 60
}
```

A regression message has `"type": "error_regression"` and carries `fingerprint`, `title`, `release`, `environment`, `occurredAt`, `resolvedAt` and `issueUrl`. When several rules point at the same destination, it gets one regression message.

## 7. Jump to the session replay

Every occurrence belongs to a session. From the **Errors** page, open an occurrence or an issue and click **View session**. If [Session replay](/docs/session-replay) recorded that visit, the session page offers **Watch replay**, and the errors of the visit appear on the player's timeline. In the other direction, the replay list has a **With errors** filter. Replay needs the Cloud or Business plan.

## Use the API

All paths are under `https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID`. Send `Authorization: Bearer YOUR_API_KEY`. Reads need the **Read** scope and writes need **Write**.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/errors` | Totals, issues and recent errors. Filters `release`, `environment`, `status` (`open`, `resolved`, `ignored`, `regressed`), and `startAt` and `endAt` in Unix milliseconds (the last 24 hours by default). |
| `GET` | `/errors/issues/FINGERPRINT` | One issue with its details. |
| `GET` | `/errors/EVENT_ID` | One occurrence. |
| `PATCH` | `/errors/issues` | Set an issue's status. Body `{"fingerprint":"...","status":"resolved"}`. It also takes `note` and `assigneeUserId`. |
| `POST` | `/errors/issues/comments` | Add a comment. Body `{"fingerprint":"...","body":"..."}`. |
| `POST` | `/errors/issues/merge` | Merge issues. Body `{"targetFingerprint":"...","sourceFingerprints":["..."]}`. |
| `DELETE` | `/errors/issues/FINGERPRINT/merge` | Unmerge an issue. |
| `GET`, `POST` | `/errors/alerts` | List or create alert rules. |
| `PATCH`, `DELETE` | `/errors/alerts/ALERT_RULE_ID` | Change or delete a rule. |

The [MCP server](/docs/mcp) also has a `list_error_issues` tool that returns error totals and the top issues, which an AI tool can read for you.

## Check that it works

1. Open your site with the script installed. In the browser console run `flareboard.captureException(new Error('Flareboard test error'))`.
2. In the console, open your website, then **Errors**. Wait a few seconds and reload.
3. The issue **Flareboard test error** appears under **Error issues**, with 1 occurrence. Open it. If you uploaded source maps for the release, the **Stack trace** shows your original files.
4. To test automatic capture, run `setTimeout(() => { throw new Error('Uncaught test error') })`. It appears as a second issue.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Nothing appears | The script is blocked (an ad blocker or a Content Security Policy that blocks `t.flareboard.dev`), the visitor opted out, or the date range or status filter hides it. **Open** is the default status filter. |
| Stack traces are minified | No map matches. Check that the `data-release` of the page equals the release you uploaded, and that the uploaded file path is the script's path (without the domain) plus `.map`, or its file name plus `.map`. |
| The upload fails with `400` | The file is not a version 3 source map, it has `sections`, or `release` is missing or over 200 characters. |
| The upload fails with `413` | The map is over 20 MB. |
| One bug is split across several issues | Its stack frames differ between occurrences, or its messages differ and there is no stack. Merge the issues, or set `$exception_fingerprint`. |
| Unrelated errors share an issue | They have no in-app stack and similar messages. Set a custom `$exception_fingerprint`. |
| An alert never fires | Rules are checked once an hour. The threshold must be reached inside the window, and the severity, release and environment filters must match. |

## Next steps

- See what the visitor did with [Session replay](/docs/session-replay).
- Send server-side logs and traces with [Logs and traces](/docs/logs-traces).
- Ask an AI tool about your errors with the [MCP server](/docs/mcp).
