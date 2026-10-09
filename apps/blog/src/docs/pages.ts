import { getCollection, type CollectionEntry } from 'astro:content';
import { DOCS_BASE } from '../consts';
import { DOCS_LANGS, DOCS_NAV, type DocsLang } from './nav';

export type DocsEntry = CollectionEntry<'docs'>;

export interface DocsPage {
  entry: DocsEntry;
  lang: DocsLang;
  /** `quickstart`, `install/script`, or `index` for the docs home. */
  slug: string;
  /** Public path: /docs/quickstart, /docs/zh/quickstart, /docs, /docs/zh. */
  href: string;
  /** Plain Markdown for agents: /docs/quickstart.md, /docs/index.md. */
  mdHref: string;
}

export function docsHref(lang: DocsLang, slug: string) {
  const prefix = lang === 'en' ? DOCS_BASE : `${DOCS_BASE}/zh`;
  return slug === 'index' ? prefix : `${prefix}/${slug}`;
}

export function docsMdHref(lang: DocsLang, slug: string) {
  return `${lang === 'en' ? DOCS_BASE : `${DOCS_BASE}/zh`}/${slug}.md`;
}

function toPage(entry: DocsEntry): DocsPage {
  const [lang, ...rest] = entry.id.split('/');
  if (!DOCS_LANGS.includes(lang as DocsLang)) throw new Error(`docs page outside en/ or zh/: ${entry.id}`);
  const slug = rest.join('/');
  return { entry, lang: lang as DocsLang, slug, href: docsHref(lang as DocsLang, slug), mdHref: docsMdHref(lang as DocsLang, slug) };
}

/** Every published page, in sidebar order per language (pages outside the sidebar come last). */
export async function getDocsPages(): Promise<DocsPage[]> {
  const pages = (await getCollection('docs', ({ data }) => !data.draft)).map(toPage);
  const order = DOCS_NAV.flatMap((group) => group.items);
  const rank = (page: DocsPage) => {
    const index = order.indexOf(page.slug);
    return index === -1 ? order.length : index;
  };
  return pages.sort((a, b) => a.lang.localeCompare(b.lang) || rank(a) - rank(b) || a.slug.localeCompare(b.slug));
}

/** The sidebar for one language, keeping only pages that exist in it. */
export function sidebarFor(pages: DocsPage[], lang: DocsLang) {
  const bySlug = new Map(pages.filter((page) => page.lang === lang).map((page) => [page.slug, page]));
  return DOCS_NAV.map((group) => ({
    title: group.title[lang],
    pages: group.items.flatMap((slug) => {
      const page = bySlug.get(slug);
      return page ? [page] : [];
    }),
  })).filter((group) => group.pages.length);
}

/**
 * The Markdown an agent reads: title, summary, then the body with docs links pointing at their
 * .md versions on the public site, so it can follow them without parsing HTML.
 */
export function pageMarkdown(page: DocsPage, site: URL) {
  const body = (page.entry.body ?? '').replace(/\]\((\/docs(?:\/[^)#\s]*)?)(#[^)\s]*)?\)/g, (match, path: string, hash = '') => {
    // Files such as /docs/llms.txt or /docs/quickstart.md are already what an agent wants.
    if (/\.[a-z]+$/.test(path)) return match;
    const clean = path.replace(/\/$/, '');
    const isZh = clean === `${DOCS_BASE}/zh` || clean.startsWith(`${DOCS_BASE}/zh/`);
    const rest = clean.slice(isZh ? `${DOCS_BASE}/zh`.length : DOCS_BASE.length).replace(/^\//, '');
    return `](${new URL(docsMdHref(isZh ? 'zh' : 'en', rest || 'index'), site).href}${hash})`;
  });
  return `# ${page.entry.data.title}\n\n> ${page.entry.data.description}\n\n${body.trim()}\n`;
}
