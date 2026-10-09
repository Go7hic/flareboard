import type { APIContext } from 'astro';
import { getDocsPages, pageMarkdown, type DocsPage } from '../../docs/pages';

/** Plain Markdown of every page for agents: /docs/quickstart.md, /docs/zh/index.md. */
export async function getStaticPaths() {
  const pages = await getDocsPages();
  return pages.map((page) => ({
    params: { path: page.mdHref.replace(/^\/docs\//, '').replace(/\.md$/, '') },
    props: { page },
  }));
}

export function GET({ props, site }: APIContext) {
  const { page } = props as { page: DocsPage };
  return new Response(pageMarkdown(page, site!), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
