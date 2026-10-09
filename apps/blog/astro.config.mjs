// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import mdx from '@astrojs/mdx';

const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://flareboard.dev').replace(/\/$/, '');

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  // Serves /blog and /docs (one Workers route each). Built files keep their public paths under
  // dist/, and shared assets live under /blog/_astro, which the /blog* route already reaches.
  outDir: './dist',
  build: { assets: 'blog/_astro' },
  trailingSlash: 'never',
  output: 'static',
  // Images ship as committed (keep them small): Sharp is not a dependency of the blog, and with
  // pnpm's isolated install the CI build cannot find it.
  image: { service: passthroughImageService() },
  markdown: {
    // Light colors inline, dark ones as --shiki-dark variables (switched in global.css).
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  // Sitemaps are endpoints under /blog and /docs: the integration would write them to the site
  // root, which belongs to the dashboard worker.
  integrations: [mdx()],
});
