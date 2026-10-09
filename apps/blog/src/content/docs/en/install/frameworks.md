---
title: Frameworks
description: Where to put the Flareboard script tag or npm package in plain HTML, Next.js, React, Vue, Nuxt, Astro, SvelteKit, WordPress and Webflow.
---

Every setup below does the same thing: load `https://t.flareboard.dev/script.js` once, with your website ID, on every page. The script follows client-side route changes on its own (it watches the History API and hash routes), so single-page apps need no router code. Replace `YOUR_WEBSITE_ID` with the ID from **Websites**, then the website's **Settings**, in the **Tracking code** card. Self-hosters replace `https://t.flareboard.dev` with their own ingest address.

Pick one method per app: the script tag or the [npm package](/docs/install/npm). Using both can record every pageview twice.

## Plain HTML

Paste the tag into the `<head>` of every page:

```html
<head>
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
</head>
```

## Next.js

### App Router

Use `next/script` in the root layout, `app/layout.tsx`. Extra props such as `data-website-id` are passed to the script element.

```tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://t.flareboard.dev/script.js"
          data-website-id="YOUR_WEBSITE_ID"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
```

To use the npm package instead, create a client component and wrap `children` in it:

```tsx
// app/providers.tsx
'use client';

import { FlareboardProvider } from '@flareboard/js/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <FlareboardProvider config={{ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' }}>
      {children}
    </FlareboardProvider>
  );
}
```

### Pages Router

Add `next/script` to `pages/_app.tsx`:

```tsx
import type { AppProps } from 'next/app';
import Script from 'next/script';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script
        src="https://t.flareboard.dev/script.js"
        data-website-id="YOUR_WEBSITE_ID"
        strategy="afterInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}
```

## React (Vite)

Add the tag to `index.html`:

```html
<head>
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
</head>
```

Or use the package. Initialize before rendering, in `src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { flareboard } from '@flareboard/js';
import App from './App';

flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });

createRoot(document.getElementById('root')!).render(<App />);
```

## Vue

Add the tag to `index.html` as in React (Vite), or initialize the package in `src/main.ts`:

```ts
import { createApp } from 'vue';
import { flareboard } from '@flareboard/js';
import App from './App.vue';

flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });

createApp(App).mount('#app');
```

## Nuxt

Add the script to the head in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [
        {
          src: 'https://t.flareboard.dev/script.js',
          defer: true,
          'data-website-id': 'YOUR_WEBSITE_ID',
        },
      ],
    },
  },
});
```

Or use the package in a client-only plugin, `plugins/flareboard.client.ts`:

```ts
import { flareboard } from '@flareboard/js';

export default defineNuxtPlugin(() => {
  flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });
});
```

## Astro

Add the tag to your layout's `<head>`. Use `is:inline` so Astro leaves the tag as written instead of bundling it:

```astro
---
// src/layouts/Layout.astro
---
<html lang="en">
  <head>
    <script is:inline defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
  </head>
  <body>
    <slot />
  </body>
</html>
```

## SvelteKit

Add the tag to `src/app.html`:

```html
<head>
  <meta charset="utf-8" />
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
  %sveltekit.head%
</head>
```

Or use the package. Initialize it in the browser from `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { flareboard } from '@flareboard/js';

  onMount(() => {
    flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });
  });
</script>
```

Keep the rest of your layout as it is.

## WordPress, Webflow and other site builders

Any builder that lets you add code to the page head works. Paste the same tag:

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

- **WordPress:** use a plugin or theme setting that inserts code into the head, or add the tag to your theme's `header.php` just before `</head>`.
- **Webflow:** paste the tag into the head code box of the site's custom code settings, then publish the site.
- **Other builders:** look for "custom code", "header code" or "head" in the site settings.

## Check that it works

1. Open your site and click to a second page.
2. In the developer tools **Network** tab, filter for `script.js` (status 200), then for `send`. Each page you open should make a `POST` to `/api/send` with status 200.
3. In Flareboard, open **Realtime** for the website. Your visit appears within a few seconds. You can also click **Test tracking** in the website's **Settings**.

If a page is missing, see [Troubleshooting](/docs/troubleshooting). To call the tracker from your own code, see [Track events](/docs/events).
