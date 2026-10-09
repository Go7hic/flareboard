---
title: Feature flags
description: Turn a feature on for a share of your visitors, serve variants with payloads, and read flags in the browser or on your server. Every read is recorded as an exposure.
---

A feature flag lets you ship code that stays hidden until you switch it on, for everyone or for a share of visitors. Flareboard evaluates each flag for the visitor, hands your code the answer, and records an exposure event when your code reads the flag. Exposures are what [Experiments](/docs/experiments) measure.

## Before you start

- **Plan:** feature flags and experiments need the Cloud or Business plan. On the Free plan the API answers `403` with "Feature flags require a paid plan." Self-hosted installs have every feature without plan limits.
- **Role:** you need an account that can edit the website. View-only accounts can open the page and read flags, but the editing controls are disabled.
- **Tracking script:** to read flags in the browser, install the [tracking script](/docs/install/script) or the [npm package](/docs/install/npm) first.

## 1. Create a flag

1. Open your website, then **Feature flags** in the sidebar.
2. Click **Create flag**.
3. Fill in the form (the table below explains each part) and click **Create flag**.

A new flag is live as soon as you save it, so start with a small rollout.

| Setting | What it does |
| --- | --- |
| **Name** | Display name. Required, up to 120 characters. |
| **Flag key** | The string your code uses, for example `checkout.new_flow`. Starts with a letter, then letters, numbers, `.`, `:`, `_` or `-`. Up to 80 characters, unique per website. |
| **Description** | Who should see the feature and why. Up to 500 characters. |
| **Release conditions** | Who gets the flag. See [Release conditions](#release-conditions). |
| **Variants** | Optional named values for a multivariate flag. See [Variants](#variants). |
| **Payload (JSON)** | Optional JSON served with the flag. See [Payloads](#payloads). |
| **Early access feature** | Lets people opt in or out themselves. See [Early access](#early-access). |

### Release conditions

A flag has one or more **condition groups**. Flareboard checks the groups in order, and the first group that matches the visitor and includes them in its rollout serves the flag.

- Inside a group, all conditions must match (and).
- A visitor who fails the first group, or falls outside its rollout, can still match a later group (or).
- A group with no conditions matches everyone.
- **Roll out to** sets what percentage of the matching people get the flag, from 0 to 100. The same visitor always lands in the same place for a given flag key.
- A flag allows up to 20 groups and up to 12 conditions per group. Click **Add condition group** or **Add condition** to add more.

Each condition has a field, an operator and a value.

| Field | Matches against |
| --- | --- |
| **Person property** | A property stored on the person, set with `identify()`. Needs a property key. |
| **Event property** | A property sent with the request. Needs a property key. The tracking script sends none, so use it with server-side evaluation. |
| **Cohort** | Membership of a cohort of this website. Uses **is in** or **is not in**. |
| **Group**, **Group property** | The group the person belongs to (needs a group type), or a property of it. |
| **Path**, **URL**, **Hostname**, **Referrer**, **Language**, **User agent** | The current page and browser. |
| **Distinct ID**, **User ID** | The identified user. |
| **Environment**, **Release** | The `data-environment` and `data-release` values of the tracking script. |

Operators for the other fields: **equals**, **does not equal**, **contains**, **does not contain**, **starts with**, **ends with**, **greater than**, **at least**, **less than**, **at most**, **is set**, **is not set**. Text comparisons ignore case. Number comparisons need both sides to be numbers.

### Variants

Without variants a flag is on or off. To split people between several values, click **Add variant** and give each variant:

- a **Variant key** (same character rules as the flag key) and a **Name**;
- a weight, a whole number from 0 to 100.

A flag allows up to 8 variants, and the weights must add up to 100 or less. Whatever the weights leave over is served as `control`. Visitors who are outside the rollout also get `control`.

For one condition group you can pick a variant under **Serve variant** instead of the weighted split. That serves every matching visitor in that group the same variant.

### Payloads

A payload is any JSON value, up to 16 KB, that comes back together with the flag. A flag without variants has one **Payload (JSON)**. A flag with variants has a **Variant payload (JSON)** for each variant. Payloads reach browsers and SDKs as they are, so never put secrets in them.

### Early access

Tick **Early access feature** and give it a public **Public name** and **Public description**. People can then opt in or out. Opting in turns the flag on for that person regardless of the conditions, and opting out keeps it off. Enrolment is stored as the person property `$feature_enrollment/FLAG_KEY`. For a flag with early access on, record someone's choice with a request like this (the key needs the **Write** scope):

```bash
curl -X PUT https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags/early-access/YOUR_FLAG_KEY/enrollment \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"distinctId":"user_123","enrolled":true}'
```

### Create or change a flag with the API

The console uses the same endpoints. Create a flag that is on for 10% of visitors:

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key":"checkout.new_flow","name":"New checkout flow","conditionGroups":[{"conditions":[],"rollout":10}]}'
```

The answer is `201` with the flag, including its `id`. Change it later with `PATCH /api/websites/YOUR_WEBSITE_ID/feature-flags/FLAG_ID` (for example `{"enabled":false}`). Create a personal API key under **API keys** in the console with the **Write** scope. Self-hosters replace `api.flareboard.dev` with their own API address. The other flag endpoints are in the [REST API](/docs/api).

## 2. Read a flag in the browser

Flags are available on the page through the tracker API. With the script tag, call `window.flareboard`. With the npm package, import `flareboard` from `@flareboard/js`.

| Method | Returns |
| --- | --- |
| `getFeatureFlag(key, fallback?)` | The variant key, `'test'` for a flag without variants that is on, `'control'` when the visitor is not served the flag, or `fallback` (default `false`) when the flag is unknown. Records an exposure. |
| `isFeatureEnabled(key, fallback?)` | `true` unless the value is `false` or `'control'`. Records an exposure. |
| `getFeatureFlagPayload(key)` | The payload for the visitor's variant, or `undefined`. Records no exposure. |
| `onFeatureFlags(callback)` | Calls `callback(enabledKeys, variants, payloads)` now if flags have loaded, and again whenever they are evaluated. Returns a function that removes the callback. Records no exposure. |
| `featureFlagsReady()` | A promise that resolves once flags have loaded. |

The script also exposes `getFeatureFlagVariant(key, fallback?)`, an alias of `getFeatureFlag`.

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev',
  websiteId: 'YOUR_WEBSITE_ID',
});

await flareboard.featureFlagsReady();

if (flareboard.isFeatureEnabled('checkout.new_flow')) {
  showNewCheckout(flareboard.getFeatureFlagPayload('checkout.new_flow'));
}

const variant = flareboard.getFeatureFlag('pricing.layout'); // 'wide', 'compact' or 'control'
```

With React, wrap your app in `FlareboardProvider` and read flags with `useFeatureFlag(key)` and `useFeatureFlagPayload(key)` from `@flareboard/js/react`. `useFeatureFlag` returns `undefined` until flags load and records the exposure once the value is known. See the [npm package](/docs/install/npm) for setup.

### When flags load

1. The script fetches the website's flags from `https://t.flareboard.dev/api/tracker-config?website=YOUR_WEBSITE_ID`. It keeps the answer for 60 seconds in `sessionStorage`, and the response itself can be cached for 60 seconds, so a change you make in the console reaches visitors within a minute or two.
2. Only enabled flags are sent. A disabled or deleted flag behaves like an unknown one, so reading it returns your `fallback` (or `false`) and records no exposure.
3. Flags that use conditions, several condition groups, **Serve variant** or early access are evaluated on the server. The script posts the page, browser and identity details to `POST /api/feature-flags/evaluate` once the flags are in. Conditions never leave the server.
4. The script then calls every `onFeatureFlags` callback and resolves `featureFlagsReady()`.
5. After each client-side route change, flags that need the server are evaluated again for the new page and the callbacks run again.

Reading a flag before step 4 gives you the fallback. Once the flag list is in but the server has not answered yet, a flag that needs the server reads `'control'`. In your UI, wait for `featureFlagsReady()` or render from an `onFeatureFlags` callback, and show nothing (or the old experience) until then. After a route change, a server-evaluated flag reads `'control'` until the new answer arrives, so use the callback there too.

### Who gets which variant

The script and the server assign the same variant to the same person. The assignment depends on a stable id for the visitor:

1. the id you pass to `identify()`;
2. otherwise a random anonymous id, but only when the website has **Remember visitors across sessions** on;
3. otherwise the session id, so an anonymous visitor can get a different variant on a later visit.

Call [identify()](/docs/events#identify-users) after sign-in when you need a visitor to keep the same variant.

## 3. Read a flag on your server

Use one of these, depending on what you already run.

| Option | Use it when | Credential |
| --- | --- | --- |
| A PostHog SDK | You already use `posthog-node` or `posthog-python`. | Project API key |
| `POST /api/feature-flags/evaluate` on ingest | You want plain HTTP and no SDK. | Website ID or project API key |
| `POST /api/websites/WEBSITE_ID/feature-flags/evaluate-all` on the API | You want every flag for one user, with the reason for each. | Personal API key with the **Write** scope |

### PostHog SDK

Point the SDK at your ingest address with the website's **Project API key**. Find it in the website's **Settings**. See [PostHog SDKs](/docs/install/posthog) for the full setup.

```ts
import { PostHog } from 'posthog-node';

const posthog = new PostHog('YOUR_PROJECT_KEY', { host: 'https://t.flareboard.dev' });

const variant = await posthog.getFeatureFlag('checkout.new_flow', 'user_123');
const enabled = await posthog.isFeatureEnabled('checkout.new_flow', 'user_123');
await posthog.shutdown();
```

Flags are evaluated on Flareboard's servers through `/flags`. Local evaluation (a personal API key plus `/api/feature_flag/local_evaluation`) is not supported. A flag without variants comes back as `true` or `false`, and a flag with variants as the variant key. A flag that does not match the user comes back as `false`, and a disabled flag is left out of the response. Payloads come back in the same response.

The `/flags` endpoint reads `distinct_id`, `groups` and `person_properties`. Properties you send in `person_properties` are matched by **Event property** conditions. **Person property** conditions use the properties Flareboard has stored for that distinct id, so identify the person first.

### Plain HTTP on ingest

```bash
curl -X POST https://t.flareboard.dev/api/feature-flags/evaluate \
  -H "Content-Type: application/json" \
  -d '{"website":"YOUR_WEBSITE_ID","keys":["checkout.new_flow"],"context":{"distinctId":"user_123"}}'
```

```json
{ "results": { "checkout.new_flow": "test" }, "payloads": {} }
```

`keys` is required (up to 200). `context` can hold `distinctId`, `userId`, `sessionId`, `visitId`, `anonymousId`, `path`, `url`, `hostname`, `referrer`, `language`, `userAgent`, `environment`, `release`, `groups`, `properties`, `personProperties` and `groupProperties`. Each key in `results` is a variant key, `'test'` (on, no variants), `'control'` (not served) or `false` (disabled or unknown). `payloads` lists the payload of each key that is on and has one. Requests with a website ID are limited to 120 per minute per IP. Requests with a project key are limited per key. This endpoint records no exposure.

### Every flag for one user, with the reason

```bash
curl -X POST https://api.flareboard.dev/api/websites/YOUR_WEBSITE_ID/feature-flags/evaluate-all \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"distinctId":"user_123","keys":["checkout.new_flow"],"personProperties":{"plan":"pro"}}'
```

The answer has `featureFlags` (variant key, or `true` or `false`), `featureFlagPayloads`, and `flags` with the full result per flag: `enabled`, `variant`, `reason` and the `conditionGroup` that decided it. Omit `keys` to get every flag. `personProperties` you send are merged over the stored ones. The key needs the **Write** scope because the request is a `POST`. It records no exposure.

## 4. How exposures are recorded

Reading a flag with `getFeatureFlag`, `isFeatureEnabled` or `useFeatureFlag` sends a `$feature_flag_called` event. It is sent once per flag per page load, and again after `reset()`. It carries these properties:

| Property | Value |
| --- | --- |
| `$feature_flag` | The flag key |
| `$feature_flag_response` | What the visitor got, for example `test`, `control` or a variant key |
| `release`, `environment` | From `data-release` and `data-environment`, when set |

After a flag is read, every later event on that page also carries `$feature/FLAG_KEY` with the variant, so you can group other events by variant. PostHog SDKs that send `$feature_flag_called` events are accepted too, and count the same way. See [PostHog SDKs](/docs/install/posthog).

In the console, open the flag and use the **Overview** tab:

- **Exposures** and **Sessions** count the `$feature_flag_called` events and the sessions behind them.
- **Exposures per day** (UTC days), **Observed split** (exposures per variant next to the configured weight; **Responses** for a flag without variants) and **Releases and environments** show where the exposures came from.
- **Recent exposures** lists the last 10, with a link to each session.
- **Needs attention** appears when a flag with exposures has no variant data, or when a flag with variants sends 90% or more of its exposures to one variant. A flag with no exposures shows **No exposures yet** instead.

## 5. Test a flag

1. Open the flag and click the **Test** tab.
2. Enter a **Distinct ID**, and optionally a **Path**, **Environment** and **Release**.
3. Click **Run evaluation**.

The result shows whether the flag is **Served**, the variant, the payload and the reason, for example "Matched a condition group", "Matched, but outside the rollout" or "No condition group matched". Running an evaluation with a **Distinct ID** records an exposure. Use `evaluate-all` or the MCP tool below when you want to check without recording one.

The **History** tab lists who changed the flag and what changed. To switch the flag off, click **Disable** at the top of the flag. Click **Enable** to turn it back on.

## 6. Control flags from MCP

The [MCP server](/docs/mcp) can read and switch flags for an AI tool.

| Tool | Key scope | What it does |
| --- | --- | --- |
| `list_feature_flags` | Read | Lists flags with state, rollout and variants. |
| `evaluate_feature_flag` | Read | Evaluates one flag for a distinct id. Records no exposure. |
| `toggle_feature_flag` | Write | Turns a flag on or off by key. The change appears in the flag's history. |
| `list_experiments` | Read | Lists experiments with their results. |

These tools need the Cloud or Business plan on hosted Flareboard.

## Check that it works

1. Create a flag with the key `test.flag` and leave the rollout at 100%.
2. Open your site and wait a few seconds. In the browser console run `await flareboard.featureFlagsReady(); flareboard.isFeatureEnabled('test.flag')`. It prints `true`.
3. In the console, open the flag. After a short delay **Exposures** shows 1 and **Recent exposures** lists your visit. If the flag does not exist for the script yet, wait a minute and reload your site, because the script caches the flag list for 60 seconds.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The flag always reads `false` | The flag is disabled, the key is misspelled, or flags have not loaded. Wait for `featureFlagsReady()`. Check that the website ID in the snippet is the right one. An ad blocker can also block `t.flareboard.dev`. |
| The flag reads `'control'` for everyone | The rollout is 0%, the visitor does not match any condition group, or the flag needs server evaluation and the answer has not arrived yet. Use the **Test** tab to see the reason. |
| A visitor gets a different variant on a later visit | The visitor is anonymous and the website does not remember visitors. Call `identify()`, or turn on **Remember visitors across sessions**. |
| A change in the console does not show on the site | The script caches flags for 60 seconds per tab session, and the config response can be cached for another 60 seconds. Reload after a minute or two. |
| No exposures appear | Only `getFeatureFlag`, `isFeatureEnabled` and `useFeatureFlag` record them. `getFeatureFlagPayload` and `onFeatureFlags` do not. |
| Deleting a flag returns `409` | An experiment uses the flag. Delete the experiment first. |
| The API returns `403` "Feature flags require a paid plan." | The website's owner is on the Free plan. See [Plans and limits](/docs/plans-limits). |

## Next steps

- Measure a change with an [experiment](/docs/experiments) on top of a flag.
- Ask visitors what they think with a [survey](/docs/surveys).
- Read and toggle flags from an AI tool with the [MCP server](/docs/mcp).
