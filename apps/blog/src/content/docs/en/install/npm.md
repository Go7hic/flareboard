---
title: Install with npm
sidebarTitle: npm package
description: Use the @flareboard/js package to load the tracker from your code, call it with TypeScript types, and use the React hooks.
---

`@flareboard/js` is a small typed loader for the [tracking script](/docs/install/script). It injects `script.js` from your ingest address and queues every call you make before the script has loaded, so you can call `flareboard.track()` right away. Use it when you build a JavaScript app and want imports and types instead of a `<script>` tag.

The package does not replace the script. It loads the same `script.js`, so the behavior, privacy rules and data are identical.

## Before you start

- A website ID. Open **Websites**, then the website's **Settings**, and copy it from the **Tracking code** card.
- A browser app. The package works in any bundler. It is published as an ES module (`"type": "module"`) with TypeScript declarations included.

## 1. Install

```bash
npm install @flareboard/js
```

`pnpm add @flareboard/js` and `yarn add @flareboard/js` work the same way.

## 2. Initialize once

Call `init` once, as early as you can, in code that runs in the browser:

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev', // your ingest address
  websiteId: 'YOUR_WEBSITE_ID',
});

flareboard.track('signup_started', { plan: 'pro' });
```

- `init` does nothing outside a browser, so it is safe to import in server-rendered apps.
- A second call to `init` is ignored, with a console warning.
- `init` needs `host` and either `websiteId` or `projectKey`. Without them it logs a warning and does nothing.
- `host` is the ingest address. The script loads from `${host}/script.js`. Self-hosters use their own address.

### Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `host` | string | required | Ingest address. The script loads from `${host}/script.js`. |
| `websiteId` | string | none | The website UUID. One of `websiteId` or `projectKey` is required. |
| `projectKey` | string | none | The website's project key (`fb_pk_...`), resolved to the website by ingest. Ignored when `websiteId` is set. |
| `autocapture` | boolean | Website setting (on) | Autocapture clicks, form submits and field changes. Field values are never sent. |
| `capturePageleave` | boolean | Same as `autocapture` | Send `$pageleave` events with time on page and scroll depth. |
| `persistence` | boolean | Website setting | `false` never keeps an anonymous visitor ID in `localStorage` on this page. Turning persistence on is a website setting. |
| `respectDnt` | boolean | Website setting (off) | Send nothing from browsers with Do Not Track or Global Privacy Control. |
| `release` | string | none | Version label for errors, logs and flag targeting. |
| `environment` | string | none | Environment label for errors, logs and flag targeting. |
| `heatmapSampleRate` | number from 0 to 1 | 0.1 | Share of clicks and scrolls sent for heatmaps until the website's settings load. |
| `scriptUrl` | string | `${host}/script.js` | Load the script from a different address. |
| `nonce` | string | none | CSP nonce for the injected `<script>` tag. |

Most options become a `data-*` attribute on the injected script tag (`host`, `scriptUrl` and `nonce` do not). See the [Tracker reference](/docs/reference/tracker) for what each does.

## 3. Call the API

The same methods as `window.flareboard`:

```ts
import { flareboard } from '@flareboard/js';

flareboard.track('checkout_started', { plan: 'pro' });
flareboard.identify('user_123', { plan: 'pro' });
flareboard.group('company', 'acme', { name: 'Acme' });
flareboard.reset(); // on sign-out

flareboard.register({ app_version: '2.4.0' }); // sent with every event

flareboard.captureException(new Error('Payment failed'), { severity: 'error' });
```

Notes:

- The package methods return nothing (`void`). The script's own methods return promises. Call the package and do not wait on it.
- Before the script has loaded, calls are queued and replayed in order. Identity, super property and consent calls (`identify`, `register`, `optOut` and similar) run before the first pageview so it carries them. Capture calls (`track`, `page`, `revenue`, `log`, `ai`, `captureException`) run after it.
- Until the script has loaded, `getDistinctId()` returns `''`, `getSessionId()` and `getVisitId()` return `null`, and feature flag getters return your fallback (or the last flags the script reported). Use `onFeatureFlags` or `featureFlagsReady()` when you need real values.
- `flareboard.loaded` is `true` once the script has loaded. `flareboard.initialized` is `true` once `init` ran in a browser.

The package exposes the methods listed in the [Tracker reference](/docs/reference/tracker#javascript-api), except `getFeatureFlagVariant` and `showSurvey`, which are only on `window.flareboard`.

## Use the package or the script tag, not both

Pick one. `init` skips injecting the script only when the tracker has already loaded. It cannot see a script tag that is still loading, so using both can load two copies and record every pageview twice.

## React

`react` 18 or later is an optional peer dependency. Wrap your app in `FlareboardProvider`:

```tsx
import { FlareboardProvider, useFeatureFlag, useFlareboard } from '@flareboard/js/react';

export function App() {
  return (
    <FlareboardProvider config={{ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' }}>
      <Checkout />
    </FlareboardProvider>
  );
}

function Checkout() {
  const flareboard = useFlareboard();
  const flow = useFeatureFlag('checkout.flow'); // undefined until flags load, or if the flag does not exist

  if (flow === undefined) return null;
  return <button onClick={() => flareboard.track('checkout_clicked')}>{flow === 'new' ? 'Pay now' : 'Checkout'}</button>;
}
```

| Export | What it does |
| --- | --- |
| `FlareboardProvider` | Calls `init(config)` once after mount and provides the client to the hooks. It is safe during server rendering. Omit `config` if you call `init` yourself. |
| `useFlareboard()` | Returns the client from the nearest provider (or the shared client). |
| `useFeatureFlag(key, fallback?)` | The flag's value. Re-renders when flags load or change. Returns `fallback` (default `undefined`) until flags have loaded, when the flag is unknown, and during server rendering. Records a flag exposure once the value is known. |
| `useFeatureFlagPayload<T>(key)` | The payload attached to the flag's assigned variant. |

Feature flags are covered in [Feature flags](/docs/feature-flags).

## TypeScript

Types ship with the package. The main ones:

```ts
import type {
  FlareboardConfig,
  FlareboardApi,
  FlareboardClient,
  Properties,
  FlagValue,
  LogLevel,
  AiObservation,
  ExceptionContext,
  FeatureFlagsCallback,
} from '@flareboard/js';
```

`Properties` is `Record<string, string | number | boolean | null | undefined>`. Nested objects are dropped by ingest, so keep event properties flat.

If you use the script tag instead and want types for `window.flareboard`:

```ts
import type { FlareboardApi } from '@flareboard/js';

declare global {
  interface Window {
    flareboard?: FlareboardApi;
  }
}
```

## Other exports

| Export | What it does |
| --- | --- |
| `flareboard` (also the default export) | The shared client. |
| `init(config)` | Shorthand for `flareboard.init(config)`. |
| `createFlareboard(env?)` | Creates a separate client. Mostly for tests. |
| `scriptSrc(config)` | The script address `init` would load. |
| `QUEUED_METHODS` | The method names that are queued before the script loads. |

## Check that it works

1. Run your app and open it in a browser.
2. In the developer tools **Network** tab, look for `script.js` from your ingest address (status 200) and a `POST` to `/api/send` (status 200).
3. In the console of the browser, type `window.flareboard`. It is an object with a `track` function once the script has loaded.
4. In the Flareboard console, open **Realtime** for the website. Your visit appears within a few seconds.

Nothing there? See [Troubleshooting](/docs/troubleshooting). The package logs `[flareboard] could not load ...` if the script cannot be fetched.

## Next steps

- [Track events](/docs/events) and [identify users](/docs/events#identify-users).
- Framework-specific setup: [Frameworks](/docs/install/frameworks).
- Every option and method: [Tracker reference](/docs/reference/tracker).
