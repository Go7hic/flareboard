// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://flareboard.dev').replace(/\/$/, '');

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  base: '/blog',
  outDir: './dist/blog',
  trailingSlash: 'never',
  output: 'static',
  // Images ship as committed (keep them small): Sharp is not a dependency of the blog, and with
  // pnpm's isolated install the CI build cannot find it.
  image: { service: passthroughImageService() },
  markdown: {
    // Light colors inline, dark ones as --shiki-dark variables (switched in global.css).
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/rss.xml'),
    }),
  ],
});
