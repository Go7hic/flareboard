# @flareboard/js

Flareboard product analytics for the browser: pageviews, custom events, autocapture, identity,
super properties, consent and feature flags, with optional React bindings.

The package is a small typed loader. It injects the tracker script from your Flareboard ingest
host and queues every call made before the script has loaded, so you can call it right away.

You need a website ID: sign up at [flareboard.dev](https://flareboard.dev) (there is a free plan),
add your site and copy its ID from Settings → Tracking code. Or look around the
[live demo](https://flareboard.dev/demo) first.

## Install

```bash
npm install @flareboard/js
```

## Quick start

```ts
import { flareboard } from '@flareboard/js';

flareboard.init({
  host: 'https://t.flareboard.dev', // your ingest host
  websiteId: 'YOUR_WEBSITE_ID', // Settings → Tracking code
});

flareboard.track('signup_started', { plan: 'pro' });
```

`init` does nothing outside the browser, so it is safe to import in server-rendered apps. Call it
once, as early as possible; later calls are ignored.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `host` | required | Ingest origin. The script loads from `${host}/script.js`. |
| `websiteId` / `projectKey` | one required | Which website to track. |
| `autocapture` | website setting | Record clicks on links and buttons, form submits and field changes. Field values are never recorded. |
| `capturePageleave` | same as `autocapture` | `$pageleave` with seconds visible and max scroll depth. |
| `persistence` | website setting | `false` never stores an anonymous visitor id in localStorage on this page (for example until the visitor consents). Turning persistence on is a website setting ("Remember visitors across sessions"). |
| `respectDnt` | website setting | Send nothing from browsers with Do Not Track or Global Privacy Control. |
| `release`, `environment` | – | Attached to errors, logs and flag targeting. |
| `heatmapSampleRate` | website setting | 0–1 share of clicks and scrolls recorded for heatmaps. |
| `scriptUrl` | `${host}/script.js` | Load the tracker from somewhere else. |
| `nonce` | – | CSP nonce for the injected script tag. |

## API

```ts
flareboard.track(name, properties?, tag?)
flareboard.page() // manual pageview; SPA routes are tracked automatically

flareboard.identify('user_123', { email: 'ada@example.com' })
flareboard.alias('old-id', 'user_123')
flareboard.group('company', 'acme', { name: 'Acme' })
flareboard.reset() // on logout: new anonymous id, clears identity and super properties

flareboard.register({ plan: 'pro' }) // sent with every event
flareboard.registerOnce({ first_touch: 'ads' }) // only if not set yet
flareboard.unregister('plan')

flareboard.optOut()
flareboard.optIn()
flareboard.hasOptedOut()

flareboard.getFeatureFlag('checkout.flow') // 'variant-a' | 'control' | 'test' | false
flareboard.isFeatureEnabled('beta')
flareboard.getFeatureFlagPayload('checkout.flow')
const stop = flareboard.onFeatureFlags((flags, variants, payloads) => {})
await flareboard.featureFlagsReady()

flareboard.captureException(error, { severity: 'error' })
flareboard.revenue(49, 'USD', { name: 'checkout' })
flareboard.log('info', 'Checkout step viewed', { step: 'payment' })
flareboard.ai({ model: 'gpt-4.1-mini', inputTokens: 120, outputTokens: 48, costUsd: 0.004 })

flareboard.getDistinctId()
flareboard.getSessionId()
```

Before the script has loaded, flag getters return your fallback (or the last flags the tracker
reported) and `getDistinctId()` returns `''`. Use `onFeatureFlags` or `featureFlagsReady()` when
you need the real values.

Calls made before the tracker loads are replayed in two groups: identity, super property and
consent calls (`identify`, `register`, `optOut`, …) run before the first pageview so it carries
them; capture calls (`track`, `page`, `revenue`, `log`, `ai`, `captureException`) run after it.

## React

`react` (18 or later) is an optional peer dependency.

```tsx
import { FlareboardProvider, useFeatureFlag, useFeatureFlagPayload, useFlareboard } from '@flareboard/js/react';

export function App() {
  return (
    <FlareboardProvider config={{ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' }}>
      <Checkout />
    </FlareboardProvider>
  );
}

function Checkout() {
  const flareboard = useFlareboard();
  const flow = useFeatureFlag('checkout.flow'); // undefined until flags load
  const copy = useFeatureFlagPayload<{ title: string }>('checkout.flow');

  if (flow === undefined) return null;
  return (
    <button onClick={() => flareboard.track('checkout_clicked')}>
      {flow === 'new' ? copy?.title : 'Checkout'}
    </button>
  );
}
```

`useFeatureFlag` re-renders when flags load or change and records the flag exposure once the
value is known. Both hooks return the fallback during server rendering.

## Privacy

- By default Flareboard is cookieless: visitors are counted with a monthly-rotating hash and the
  script keeps tab-scoped data in `sessionStorage`.
- With "Remember visitors across sessions" on, a random id is stored in `localStorage`. That is
  an identifier on the visitor's device, so depending on where your visitors are you may need
  their consent first: load with `persistence: false` until they agree, or call `optOut()`.
- Autocapture never records what is typed or selected, never reads text from password or
  sensitive-looking fields, and skips anything inside `[data-fb-no-capture]` or `.ph-no-capture`.

## Development

```bash
pnpm --filter @flareboard/js test
pnpm --filter @flareboard/js build # emits dist/ (ESM + .d.ts)
```

The tracker script itself lives in `apps/ingest/src/tracker/script.ts`;
`apps/ingest/test-node/sdk-contract.test.ts` runs this package against it.

## Links

- [flareboard.dev](https://flareboard.dev) · [Live demo](https://flareboard.dev/demo) · [Pricing](https://flareboard.dev/pricing)
- [Source](https://github.com/Go7hic/flareboard/tree/main/packages/sdk-js) ·
  [Tracking reference](https://github.com/Go7hic/flareboard/blob/main/docs/ingest.md)
