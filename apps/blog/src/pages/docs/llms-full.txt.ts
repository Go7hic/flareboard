import type { APIContext } from 'astro';
import { getDocsPages, pageMarkdown } from '../../docs/pages';

/** Every English page in sidebar order, for agents that want the whole manual in one request. */
export async function GET({ site }: APIContext) {
  const pages = (await getDocsPages()).filter((page) => page.lang === 'en');
  const body = pages.map((page) => `<!-- ${new URL(page.href, site).href} -->\n${pageMarkdown(page, site!)}`).join('\n---\n\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
