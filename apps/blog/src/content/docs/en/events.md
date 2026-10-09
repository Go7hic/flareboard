---
title: Track events
description: Send custom events with flareboard.track() or HTML attributes, identify signed-in users, group them, and understand what autocapture records.
---

Pageviews are recorded automatically. Events record everything else: sign-ups, purchases, button clicks, feature use. You send them from JavaScript with `flareboard.track()`, or with HTML attributes and no JavaScript. Events appear under **Events** for the website, and in funnels, retention and the other [product analytics](/docs/product-analytics) views.

## Before you start

The [tracking script](/docs/install/script) or the [npm package](/docs/install/npm) must be installed on the page.

## Track an event in JavaScript

```js
flareboard.track('signup_completed', { plan: 'pro', source: 'pricing_page' });
```

| Argument | Type | What it does |
| --- | --- | --- |
| `name` | string | Event name, up to 50 characters. Required. |
| `data` | object | Optional properties, flat key and value pairs. See [limits](#naming-and-property-limits). |
| `tag` | string | Optional label, up to 50 characters, stored with the event. |

The script version returns a promise that resolves when the request finishes. It never rejects: a failed send logs `[flareboard] send failed` in the console. You do not need to wait for it.

With the npm package the call is the same:

```ts
import { flareboard } from '@flareboard/js';

flareboard.track('signup_completed', { plan: 'pro' });
```

### Calling before the script has loaded

The script tag uses `defer`, so an inline `<script>` that calls `flareboard.track()` runs too early and fails with `flareboard is not defined`. Either call it from an event handler or after the page has loaded, use the npm package (which queues calls), or push the call onto the queue the script reads when it starts:

```html
<script>
  window.flareboard = window.flareboard || { _q: [] };
  window.flareboard._q.push(['track', ['pricing_viewed', { plan: 'pro' }]]);
</script>
```

Each queue entry is `[methodName, [arguments]]`. Queued capture calls (`track`, `page`, `revenue`, `log`, `ai`, `captureException`) run after the first pageview.

## Track clicks without JavaScript

Add `data-flareboard-event` to an element. Clicking the element, or anything inside it, sends the event. Properties come from `data-flareboard-event-<name>` attributes, and the tag from `data-flareboard-event-tag`:

```html
<button data-flareboard-event="signup" data-flareboard-event-plan="pro" data-flareboard-event-tag="hero">
  Sign up
</button>
```

This sends the event `signup` with the property `plan` set to `pro` and the tag `hero`. Property values are always strings, and the property name is the part of the attribute after `data-flareboard-event-`.

The Umami attributes work too: `data-umami-event`, `data-umami-event-<name>` and `data-umami-event-tag`. If you are moving from Umami, your existing markup keeps working.

## Identify users

By default a visitor is anonymous: counted with a monthly-salted hash of IP and user agent, with no ID stored. Call `identify` after sign-in to attach events to your own user ID:

```js
flareboard.identify('user_123', { plan: 'pro' });
```

| Argument | Type | What it does |
| --- | --- | --- |
| `distinctId` | string | Your stable ID for the user. Required. An empty value does nothing. |
| `properties` | object | Optional person properties, flat key and value pairs. They are saved on the person's profile under **People**. |

After `identify`:

- The ID is remembered in the browser (in `localStorage`) and sent with every later event until you call `reset()`. You do not need to call `identify` again on each page.
- If the website has **Remember visitors across sessions** on, the earlier anonymous activity is linked to the user with an alias.

Use an internal ID that means nothing outside your system, such as a database ID, as the distinct ID. Do not send passwords, payment details or other data you would not want stored in an analytics tool.

To link two IDs yourself, use `flareboard.alias(alias, distinctId)`. See the [Tracker reference](/docs/reference/tracker#javascript-api).

### Reset on sign-out

Call `reset()` when the user signs out, so the next person on the same browser is not attributed to them:

```js
flareboard.reset();
```

`reset()` clears the identified ID, the anonymous ID, the session and visit IDs, and any [super properties](#properties-on-every-event). It does not clear an opt-out.

### Groups

Use `group` to put users into an account, company or team:

```js
flareboard.group('company', 'acme', { name: 'Acme' });
```

The arguments are the group type (up to 80 characters), the group key (up to 200 characters) and optional properties. A call without a type or key does nothing. The group is linked to a person when the visitor has an ID, which means after `identify`, or when **Remember visitors across sessions** is on. Groups show under **Groups** in the console.

## Properties on every event

Super properties are sent with every event until you remove them. Use them for values that apply to the whole session, such as an app version:

```js
flareboard.register({ app_version: '2.4.0' });
flareboard.registerOnce({ first_touch: 'ads' }); // only if not set yet
flareboard.unregister('app_version');
```

Properties you pass to `track` win over super properties with the same name. An event carries at most 100 properties in total. Super properties are kept for the tab (in `sessionStorage`), or in `localStorage` when the website remembers visitors.

## Autocapture

Autocapture records interactions without code. It sends `$autocapture` events for:

- clicks on links, buttons, elements with `role="button"`, and `input` elements of type `submit` or `button`;
- form submits;
- changes to `input`, `select` and `textarea` fields.

Autocapture never sends what a visitor typed or selected. Field values are not read at all. For each interaction it sends element details only:

| Property | Content |
| --- | --- |
| `$event_type` | `click`, `submit` or `change` |
| `$el_tag` | The element's tag name |
| `$el_id`, `$el_classes` | ID and up to 10 class names |
| `$el_type`, `$el_name` | `type` of inputs and buttons; `name` of fields and forms |
| `$el_text` | Visible text, up to 255 characters. Never for fields, password or sensitive-looking elements, or text that looks like an email address, card number or similar number. |
| `$el_href` | A link's `href` (up to 500 characters; not for `javascript:` links) |
| `$el_selector` | The element and up to five ancestors, for example `div.menu > a.nav-link` |

Rules the script applies:

- Password and hidden fields, and fields whose attributes look sensitive (for example `otp`, `cvv`, `iban`, `token` or `secret` in the name or ID), are skipped for `change` events.
- Anything inside an element with `data-fb-no-capture`, or with the class `ph-no-capture`, is never captured, and its text is left out of its parents' text.
- Per page (a page load or a route change starts a new count) it sends a burst of at most 10, refilling one per second, and at most 100. The same element clicked again within one second is dropped.
- It is on by default and follows the website setting **Autocapture clicks, form submits and page leaves**, under **Data collection** in **Settings**. `data-autocapture="true"` or `"false"` on the script tag overrides it for that page. Autocapture events count toward your plan.

Autocapture also sends a `$pageleave` event with time on page and scroll depth when a visitor leaves a page. It follows autocapture unless you set `data-pageleave`.

Mark elements you want left out:

```html
<div data-fb-no-capture>
  <button>Delete account</button>
</div>
```

## Naming and property limits

Use one consistent style for event names, such as `object_action` in lowercase (`invoice_paid`, `signup_completed`). Pick one case and keep it. Name the action, not the button. Put the variable parts in properties, not in the name (`plan_selected` with `plan: 'pro'`, not `plan_pro_selected`).

Do not start your own names with `$`. Flareboard uses that prefix for its own events: `$autocapture`, `$pageleave`, `$alias` and `$feature_flag_called`. The survey widget sends `survey_response`.

| Limit | Value |
| --- | --- |
| Event name | 50 characters. A longer name makes the whole request fail with HTTP 400. |
| Tag | 50 characters. |
| Properties per event | 100. Ingest rejects a request with more (HTTP 400). The script keeps at most 100 when it merges super properties. |
| Property value types | Strings, numbers and booleans are stored. `null`, `undefined`, objects and arrays are dropped. |
| String length | A string value over 2,000 characters is truncated. |
| Request size | 64 KB per request. |
| Request rate | 100 requests per minute per IP address and website. Over that, ingest answers HTTP 429. |

## Related calls

| Call | Use it for |
| --- | --- |
| `flareboard.revenue(amount, currency, { name, data })` | Record revenue with an event. Pass a `name` in the third argument. The currency defaults to `USD`. |
| `flareboard.captureException(error, context)` | Send a handled error. See [Error tracking](/docs/error-tracking). |
| `flareboard.log(level, message, data)` | Send a structured log line. See [Logs and traces](/docs/logs-traces). |
| `flareboard.ai(observation)` | Record an LLM call. See [LLM analytics](/docs/llm-analytics). |
| `flareboard.optOut()` and `flareboard.optIn()` | Stop and resume all tracking for this browser, for example from a consent banner. |

All of them are listed in the [Tracker reference](/docs/reference/tracker#javascript-api). Events from servers and apps without the browser script are covered in [Server-side events](/docs/install/server).

## Check that it works

1. Trigger the event on your site.
2. In the browser developer tools **Network** tab, find the `POST` to `/api/send`. Its request payload contains `"name":"your_event_name"` and your properties under `data`. The response status is 200.
3. In Flareboard, open **Events** for the website. The event name appears in the list. Open **Realtime** to see it within seconds.

Nothing there? See [Troubleshooting](/docs/troubleshooting).
