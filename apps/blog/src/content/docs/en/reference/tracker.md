---
title: Tracker reference
description: Every script tag attribute, the window.flareboard JavaScript API, the events the tracker sends, the requests it makes and what it stores in the browser.
---

Facts about `script.js`, the browser tracker served at `https://t.flareboard.dev/script.js`. For how to install it, see [Install the tracking script](/docs/install/script). Self-hosters replace the address with their own ingest address.

## Script tag attributes

All attributes go on the `<script>` tag that loads `script.js`, and all are optional except the website identifier. Where an attribute is absent, the script follows the website's settings.

| Attribute | Values | Default | Effect |
| --- | --- | --- | --- |
| `data-website-id` | Website UUID | none | The website that receives data. Required unless `data-project-key` is set. |
| `data-project-key` | `fb_pk_...` key | none | Used when there is no `data-website-id`. The script requests `/api/tracker-config?key=...` and uses the `websiteId` in the answer. If that fails it sends nothing. |
| `data-autocapture` | `true`, `false` | Website setting (on) | Any value except `false` counts as on. Overrides the website setting for this page. |
| `data-pageleave` | `true`, `false` | Same as autocapture | Any value except `false` counts as on. Controls `$pageleave` events. |
| `data-persistence` | `false` | Website setting (off) | Only `false` has an effect: the page never keeps an anonymous ID in `localStorage`. |
| `data-respect-dnt` | present, or `false` | Website setting (off) | Present with any value except `false` means: send nothing from browsers with Do Not Track or Global Privacy Control. `false` turns the website setting off for this page. |
| `data-environment` | Text | none | Sent as `environment` with errors and logs, and used as `environment` in feature flag targeting. |
| `data-release` | Text | none | Sent as `release` with errors and logs, and used as `release` in feature flag targeting. |
| `data-heatmap-sample-rate` | Number 0 to 1 | 0.1 | Share of clicks and scrolls sent for heatmaps. Values are clamped to 0 to 1. The website's heatmap settings replace it once they load. |

The `recorder.js` tag for [Session replay](/docs/session-replay) reads `data-website-id` and `data-respect-dnt`.

### Attributes on page elements

| Attribute | Used by | Effect |
| --- | --- | --- |
| `data-flareboard-event` | Tracker | Clicking the element or a descendant sends an event with this name. |
| `data-flareboard-event-<name>` | Tracker | Adds the property `<name>` with the attribute's value (a string) to that event. |
| `data-flareboard-event-tag` | Tracker | Sets the event's tag. |
| `data-umami-event`, `data-umami-event-<name>`, `data-umami-event-tag` | Tracker | Same as the `data-flareboard-event` attributes, for Umami markup. |
| `data-fb-no-capture` or class `ph-no-capture` | Tracker and recorder | Autocapture skips the element and everything inside it. The recorder does not record it (a placeholder of the same size is kept). |
| `data-fb-block`, class `fb-block` or `ph-block` | Recorder | The element is not recorded. |
| `data-fb-mask`, class `fb-mask` or `ph-mask` | Recorder | Text and inputs inside are masked. |

## JavaScript API

After the script loads, `window.flareboard` is the API (`window.Flareboard` is the same object). Methods that send data return a promise that resolves when the request finishes. The promise never rejects. A method returns `undefined` instead when it has nothing to send, such as no website ID. The [npm package](/docs/install/npm) wraps these methods and returns nothing.

### Events and pages

| Method | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `track` | `name`, `data?`, `tag?` | Promise | Sends a custom event. Also lets a [survey](/docs/surveys) with that trigger event appear. See [Track events](/docs/events). |
| `page` | none | Promise | Sends a pageview for the current URL, and a `$pageleave` for the page before when it is on. SPA route changes do this on their own. |
| `revenue` | `amount`, `currency?`, `extra?` | Promise | Sends an event with `revenue` and `currency` (default `USD`). `extra` can hold `name` and `data`. Pass a `name`. |
| `captureException` | `error`, `extra?` | Promise | Sends an error with `handled: true`. `extra` can set `severity`, `handled`, `release`, `environment` and `data`. See [Error tracking](/docs/error-tracking). |
| `log` | `level`, `message`, `data?` | Promise | Sends a log line. `level` is `trace`, `debug`, `info`, `warn`, `error` or `fatal` (default `info`). See [Logs and traces](/docs/logs-traces). |
| `ai` | `observation` | Promise | Sends an LLM observation. See [LLM analytics](/docs/llm-analytics). |

### Identity

| Method | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `identify` | `distinctId`, `data?` | Promise | Stores the ID (`localStorage` and `sessionStorage`) and sends it with every later event. Saves `data` on the person. Does nothing for an empty ID. |
| `alias` | `alias`, `distinctId?` | Promise | Sends a `$alias` event that links `alias` to `distinctId` (default: the current distinct ID). |
| `group` | `type`, `key`, `data?` | Promise | Adds the visitor to a group. Does nothing without a type or a key. |
| `reset` | none | nothing | Clears the identified ID, anonymous ID, session and visit IDs, cache token, flag exposures and super properties. Does not clear an opt-out. |
| `getDistinctId` | none | string | The identified ID, else the anonymous ID. Empty when no user is identified and visitors are not remembered (the website setting is off, or the tag has `data-persistence="false"`). |
| `getSessionId` | none | string or `null` | The session ID from the last accepted request. |
| `getVisitId` | none | string or `null` | The visit ID from the last accepted request. |

### Super properties

| Method | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `register` | `properties` | nothing | Merges the properties into every later event. |
| `registerOnce` | `properties` | nothing | Like `register`, but keeps a value that is already set. |
| `unregister` | `key` | nothing | Removes one property. |

Event properties win over super properties with the same name. An event carries at most 100 properties in total.

### Consent

| Method | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `optOut` | none | nothing | Stops all sending and surveys. Stored in `localStorage` as `flareboard.opt_out`, so it lasts across visits. The session recorder stops too. |
| `optIn` | none | nothing | Clears the opt-out. If the first pageview was held back, it is sent now. |
| `hasOptedOut` | none | boolean | `true` after `optOut()`, or when a Do Not Track or Global Privacy Control signal is present and the tag or website respects it. |

### Feature flags and surveys

| Method | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `getFeatureFlag` | `key`, `fallback?` | string or boolean | A variant key, `'control'`, `'test'` for an enabled flag without variants, or `false`. An unknown flag returns `fallback` (default `false`). Records a `$feature_flag_called` event once per flag per page load. |
| `getFeatureFlagVariant` | `key`, `fallback?` | string or boolean | Same as `getFeatureFlag`. |
| `isFeatureEnabled` | `key`, `fallback?` | boolean | `true` when the value is not `false` and not `'control'`. |
| `getFeatureFlagPayload` | `key` | any | The payload of the flag's assigned variant, or `undefined`. |
| `onFeatureFlags` | `callback(flags, variants, payloads)` | function | Calls the callback once flags are loaded and again after route changes. Returns a function that removes it. |
| `featureFlagsReady` | none | Promise | Resolves when flags have loaded. |
| `showSurvey` | none | nothing | Shows an eligible survey now. |

See [Feature flags](/docs/feature-flags) and [Surveys](/docs/surveys).

### Calls before the script loads

Set `window.flareboard = { _q: [[method, args], ...] }` before the script runs, for example:

```html
<script>
  window.flareboard = window.flareboard || { _q: [] };
  window.flareboard._q.push(['track', ['pricing_viewed', { plan: 'pro' }]]);
</script>
```

When the script starts it replays the queue in two groups. `track`, `page`, `revenue`, `log`, `ai`, `captureException` and `showSurvey` run after the first pageview. Every other method (identity, super properties, consent, flags) runs before it, so the pageview carries them. An unknown method name is ignored. A queued `optOut` stops the first pageview. The npm package builds this queue for you.

## Events the tracker sends

| Event | When | Properties |
| --- | --- | --- |
| Pageview (no name) | Page load, route change, `page()` | none |
| `$pageleave` | `pagehide`, and before the next route change, when autocapture or `data-pageleave` is on | `$time_on_page` (seconds visible), `$max_scroll_depth` (percent) |
| `$autocapture` | Click, submit or change on an eligible element, when autocapture is on | `$event_type`, `$el_tag`, `$el_id`, `$el_classes`, `$el_type`, `$el_name`, `$el_text`, `$el_href`, `$el_selector`. Field values are never sent. See [Track events](/docs/events#autocapture). |
| `$alias` | `identify()` after anonymous activity, and `alias()` | `alias`, `distinctId` |
| `$feature_flag_called` | First read of a flag | `$feature_flag`, `$feature_flag_response`, `$feature/<key>` |
| `survey_response` | A survey is completed | `surveyId` |
| Error | An uncaught error or unhandled promise rejection, and `captureException()` | message, name, stack (up to 12,000 characters), source, line, column, `handled`, `severity` |
| Performance | Once per page load, when the page is hidden or after 10 seconds | `lcp`, `inp`, `cls`, `fcp`, `ttfb` |
| Heatmap click and scroll | A sample of clicks and scroll depths, at the heatmap sample rate | Position and viewport for clicks, depth for scrolls |

Names that start with `$` are reserved by Flareboard.

## Requests the tracker makes

All requests go to the origin the script was loaded from.

| Request | When | Body |
| --- | --- | --- |
| `GET /api/tracker-config?website=ID` (or `?key=KEY`) | On load, unless a copy under 60 seconds old is in `sessionStorage` | none |
| `POST /api/send` | Every pageview, event, identify, group, error, log, AI observation, web vitals and heatmap sample | JSON sent as `text/plain`: `{"type": ..., "payload": {...}, "cache": ...}`. `type` is one of `event`, `identify`, `group`, `error`, `log`, `ai`, `performance` or `heatmap`. |
| `POST /api/feature-flags/evaluate` | When the website has flags that need server evaluation, on load and on route changes | JSON |
| `POST /api/surveys/response` | When a visitor answers a survey | JSON |

`recorder.js` adds `POST /api/record` and its own `GET /api/tracker-config`. The `text/plain` content type avoids a CORS preflight. The first request of a visit carries no `cache` value. The answer holds one, which the script keeps in `sessionStorage` and sends with later requests. Ingest allows 100 requests per minute per IP address and website, and a body of up to 64 KB. See the [ingest API reference](/docs/reference/ingest-api).

## Do Not Track and opt-out

- A browser signals Do Not Track when `navigator.doNotTrack` (or `window.doNotTrack`, `navigator.msDoNotTrack`) is `1` or `yes`, or `navigator.globalPrivacyControl` is `true`.
- With `data-respect-dnt` on the tag, the script sends nothing from such a browser, immediately.
- Without the attribute, the website setting decides. Until the script knows the setting, it holds sends from browsers with a signal (up to 100). If the setting is off or cannot be loaded, it sends them.
- A visitor who called `optOut()` is never tracked until `optIn()`, regardless of the signal.

## Browser storage

The script sets no cookies. It uses these keys:

| Key | Where | Content |
| --- | --- | --- |
| `flareboard.distinct_id` | `localStorage` and `sessionStorage` | The ID passed to `identify()`. |
| `flareboard.anon_id` | `localStorage` when the website remembers visitors and `data-persistence` is not `false`; otherwise `sessionStorage` while the setting loads | A random anonymous visitor ID. |
| `flareboard.props` | `localStorage` when visitors are remembered, else `sessionStorage` | Super properties as JSON. |
| `flareboard.opt_out` | `localStorage` | `1` after `optOut()`. |
| `flareboard.survey:<id>` | `localStorage` and `sessionStorage` | When that survey was last shown. |
| `flareboard.cache` | `sessionStorage` | Session token returned by ingest. |
| `flareboard.sid`, `flareboard.vid` | `sessionStorage` | Session and visit IDs. |
| `flareboard.scroll:<path>` | `sessionStorage` | Deepest scroll position seen, per path. |
| `flareboard.hmCfg:<websiteId>` | `sessionStorage` | The website's settings, cached for 60 seconds. |

If the browser blocks storage, the script keeps the values in memory for the page.

## The npm package

[`@flareboard/js`](/docs/install/npm) injects this same script and exposes these methods with types, except `getFeatureFlagVariant` and `showSurvey`.
