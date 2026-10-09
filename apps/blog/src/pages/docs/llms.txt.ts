import type { APIContext } from 'astro';
import { getDocsPages, sidebarFor } from '../../docs/pages';

/** The docs index for agents (llmstxt.org): every page with its Markdown URL and summary. */
export async function GET({ site }: APIContext) {
  const pages = await getDocsPages();
  const section = (lang: 'en' | 'zh') =>
    sidebarFor(pages, lang)
      .map(
        (group) =>
          `## ${group.title}\n\n` +
          group.pages
            .map((page) => `- [${page.entry.data.title}](${new URL(page.mdHref, site).href}): ${page.entry.data.description}`)
            .join('\n'),
      )
      .join('\n\n');
  const body = `# Flareboard docs

> Flareboard is product analytics that runs on Cloudflare: web analytics, funnels, session replay, feature flags, experiments, errors, logs and LLM costs. Use Flareboard Cloud at https://flareboard.dev or self-host it on your own Cloudflare account.

Every page below is plain Markdown. The whole English documentation in one file: ${new URL('/docs/llms-full.txt', site).href}. Chinese pages are listed after the English ones.

${section('en')}

# 中文文档

全部中文文档合并为一个文件：${new URL('/docs/zh/llms-full.txt', site).href}

${section('zh')}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
