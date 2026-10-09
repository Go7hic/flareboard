---
title: 框架
description: 在纯 HTML、Next.js、React、Vue、Nuxt、Astro、SvelteKit、WordPress 和 Webflow 中，Flareboard 的 script 标签或 npm 包应该放在哪里。
---

下面每种设置做的事情都一样：在每个页面上带着你的网站 ID 加载一次 `https://t.flareboard.dev/script.js`。脚本会自己跟踪客户端路由切换（它监听 History API 和 hash 路由），所以单页应用不需要路由相关的代码。把 `YOUR_WEBSITE_ID` 换成 **网站** 下该网站 **设置** 里 **跟踪代码** 卡片中的 ID。自托管用户把 `https://t.flareboard.dev` 换成自己的采集地址。

每个应用只选一种方式：script 标签或 [npm 包](/docs/zh/install/npm)。两者并用可能导致每次页面浏览被记录两次。

## 纯 HTML

把标签粘贴到每个页面的 `<head>` 中：

```html
<head>
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
</head>
```

## Next.js

### App Router

在根布局 `app/layout.tsx` 中使用 `next/script`。`data-website-id` 这类额外的 props 会传给 script 元素。

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

如果改用 npm 包，创建一个客户端组件，并用它包住 `children`：

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

在 `pages/_app.tsx` 中加入 `next/script`：

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

把标签加到 `index.html`：

```html
<head>
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
</head>
```

或者使用 npm 包。在渲染之前初始化，写在 `src/main.tsx` 中：

```tsx
import { createRoot } from 'react-dom/client';
import { flareboard } from '@flareboard/js';
import App from './App';

flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });

createRoot(document.getElementById('root')!).render(<App />);
```

## Vue

像 React (Vite) 那样把标签加到 `index.html`，或者在 `src/main.ts` 中初始化 npm 包：

```ts
import { createApp } from 'vue';
import { flareboard } from '@flareboard/js';
import App from './App.vue';

flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });

createApp(App).mount('#app');
```

## Nuxt

在 `nuxt.config.ts` 中把脚本加到 head：

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

或者在仅客户端的插件 `plugins/flareboard.client.ts` 中使用 npm 包：

```ts
import { flareboard } from '@flareboard/js';

export default defineNuxtPlugin(() => {
  flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });
});
```

## Astro

把标签加到布局的 `<head>` 中。使用 `is:inline`，让 Astro 保持标签原样，而不是把它打包：

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

把标签加到 `src/app.html`：

```html
<head>
  <meta charset="utf-8" />
  <script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
  %sveltekit.head%
</head>
```

或者使用 npm 包。在 `src/routes/+layout.svelte` 中于浏览器端初始化：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { flareboard } from '@flareboard/js';

  onMount(() => {
    flareboard.init({ host: 'https://t.flareboard.dev', websiteId: 'YOUR_WEBSITE_ID' });
  });
</script>
```

布局的其余部分保持不变。

## WordPress、Webflow 和其他建站工具

任何允许你向页面 head 添加代码的建站工具都可以使用。粘贴同样的标签：

```html
<script defer src="https://t.flareboard.dev/script.js" data-website-id="YOUR_WEBSITE_ID"></script>
```

- **WordPress：** 使用能向 head 插入代码的插件或主题设置，或者把标签加到主题的 `header.php` 中，紧挨在 `</head>` 之前。
- **Webflow：** 把标签粘贴到站点自定义代码设置的 head 代码框中，然后发布站点。
- **其他建站工具：** 在站点设置中查找“自定义代码”“页头代码”或“head”。

## 检查是否生效

1. 打开你的网站，并点击进入第二个页面。
2. 在开发者工具的 **Network** 标签中，先筛选 `script.js`（状态 200），再筛选 `send`。你打开的每个页面都应该产生一次对 `/api/send` 的 `POST`，状态为 200。
3. 在 Flareboard 中打开该网站的 **实时**。你的访问会在几秒内出现。你也可以在网站的 **设置** 中点击 **测试连接**。

如果某个页面没有数据，见 [故障排查](/docs/zh/troubleshooting)。想在自己的代码中调用追踪器，见 [追踪事件](/docs/zh/events)。
