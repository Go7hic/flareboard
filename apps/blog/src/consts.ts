/** Marketing site origin (dashboard landing routes). */
export const MARKETING_ORIGIN =
  import.meta.env.PUBLIC_MARKETING_ORIGIN?.replace(/\/$/, '') ?? 'https://flareboard.dev';

export const GITHUB_URL = 'https://github.com/Go7hic/flareboard';
/** The blog and the docs share this app; Workers routes send /blog* and /docs* here. */
export const BLOG_BASE = '/blog';
export const DOCS_BASE = '/docs';

export const SITE = {
  title: 'Flareboard Blog',
  description:
    'Product analytics on Cloudflare Workers — updates, guides, and comparisons for flags, experiments, replay, and warehouse workflows.',
  author: 'Flareboard',
} as const;
