import type { APIContext } from 'astro';
import { getDocsPages, pageMarkdown } from '../../../docs/pages';

/** Every Chinese page in sidebar order. */
export async function GET({ site }: APIContext) {
  const pages = (await getDocsPages()).filter((page) => page.lang === 'zh');
  const body = pages.map((page) => `<!-- ${new URL(page.href, site).href} -->\n${pageMarkdown(page, site!)}`).join('\n---\n\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
