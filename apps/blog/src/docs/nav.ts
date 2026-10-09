export type DocsLang = 'en' | 'zh';
export const DOCS_LANGS: DocsLang[] = ['en', 'zh'];

/**
 * The docs table of contents. Each item is a page slug: `src/content/docs/<lang>/<slug>.md`
 * (`index` is the docs home). A page missing in one language is left out of that language's
 * sidebar rather than linking to a 404.
 */
export const DOCS_NAV: { title: Record<DocsLang, string>; items: string[] }[] = [
  { title: { en: 'Get started', zh: '开始使用' }, items: ['index', 'quickstart', 'concepts', 'ai-agents'] },
  {
    title: { en: 'Send data', zh: '采集数据' },
    items: ['install/script', 'install/npm', 'install/frameworks', 'install/posthog', 'install/server', 'events', 'troubleshooting'],
  },
  { title: { en: 'Analyze', zh: '分析' }, items: ['web-analytics', 'product-analytics', 'session-replay', 'heatmaps'] },
  { title: { en: 'Ship and measure', zh: '发布与实验' }, items: ['feature-flags', 'experiments', 'surveys'] },
  { title: { en: 'Engineering', zh: '工程' }, items: ['error-tracking', 'logs-traces', 'llm-analytics'] },
  { title: { en: 'Automate and share', zh: '自动化与分享' }, items: ['boards-reports', 'workflows', 'warehouse'] },
  { title: { en: 'Integrations', zh: '集成' }, items: ['mcp', 'api'] },
  { title: { en: 'Account', zh: '账户' }, items: ['teams', 'security', 'plans-limits', 'privacy-data'] },
  { title: { en: 'Self-host', zh: '自托管' }, items: ['self-host/deploy', 'self-host/configuration', 'self-host/upgrade'] },
  { title: { en: 'Reference', zh: '参考' }, items: ['reference/tracker', 'reference/ingest-api'] },
];

export const DOCS_UI: Record<DocsLang, Record<string, string>> = {
  en: {
    docs: 'Docs',
    onThisPage: 'On this page',
    copyMarkdown: 'Copy as Markdown',
    copied: 'Copied',
    viewMarkdown: 'View Markdown',
    otherLang: '中文',
    previous: 'Previous',
    next: 'Next',
    menu: 'Menu',
    edit: 'Edit this page',
    agentHint: 'For AI agents: every page is also plain Markdown at the same URL plus .md, and /docs/llms.txt lists them all.',
  },
  zh: {
    docs: '文档',
    onThisPage: '本页内容',
    copyMarkdown: '复制为 Markdown',
    copied: '已复制',
    viewMarkdown: '查看 Markdown',
    otherLang: 'English',
    previous: '上一页',
    next: '下一页',
    menu: '目录',
    edit: '编辑此页',
    agentHint: '给 AI Agent：每页在同一网址后加 .md 就是纯 Markdown 版本，/docs/llms.txt 列出了全部页面。',
  },
};
