import { sitemapIndex } from '../../lib/sitemap';

/** Kept at the address the blog sitemap always had; it also lists the docs. */
export function GET(context: { site: URL }) {
  return sitemapIndex([new URL('/blog/sitemap-0.xml', context.site).href, new URL('/docs/sitemap.xml', context.site).href]);
}
