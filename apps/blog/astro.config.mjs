// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://flareboard.dev').replace(/\/$/, '');

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  base: '/blog',
  trailingSlash: 'never',
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/rss.xml'),
    }),
  ],
});
