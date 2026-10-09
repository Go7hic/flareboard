import type { APIContext } from 'astro';
import { getDocsPages } from '../../docs/pages';
import { urlset } from '../../lib/sitemap';

export async function GET({ site }: APIContext) {
  const pages = await getDocsPages();
  return urlset(pages.map((page) => ({ loc: new URL(page.href, site).href })));
}
