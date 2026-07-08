/** Marketing site origin (dashboard landing routes). */
export const MARKETING_ORIGIN =
  import.meta.env.PUBLIC_MARKETING_ORIGIN?.replace(/\/$/, '') ?? 'https://flareboard.dev';

export const GITHUB_URL = 'https://github.com/Go7hic/flareboard';
export const DEPLOY_DOCS_URL = `${GITHUB_URL}/blob/main/docs/deployment.md`;

export const SITE = {
  title: 'Flareboard Blog',
  description:
    'Product analytics on Cloudflare Workers — updates, guides, and comparisons for flags, experiments, replay, and warehouse workflows.',
  author: 'Flareboard',
} as const;
