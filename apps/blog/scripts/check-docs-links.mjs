// Checks every link in the built docs (build.format "file"): /docs/... pages must exist, #anchors must match a heading id
// on the target page, and each English page should have a Chinese twin (and the other way round).
//   pnpm --filter @flareboard/blog build && node apps/blog/scripts/check-docs-links.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const docsDir = join(dist, 'docs');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

/** /docs/quickstart -> dist/docs/quickstart/index.html (or .html). */
function fileFor(pathname) {
  const clean = pathname.replace(/\/$/, '');
  for (const candidate of [join(dist, clean, 'index.html'), join(dist, `${clean}.html`), join(dist, clean)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const ids = new Map();
function idsOf(file) {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
}

const problems = [];
// The docs home is dist/docs.html; every other page is under dist/docs/.
const pages = [join(dist, 'docs.html'), ...htmlFiles(docsDir)].filter((file) => existsSync(file));
/** dist/docs/zh/events.html -> /docs/zh/events */
const urlOf = (file) => '/' + relative(dist, file).replace(/\.html$/, '').replace(/\/index$/, '');
for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const start = html.indexOf('<article class="docs-article"');
  const article = html.slice(start, html.indexOf('</article>', start));
  if (start < 0) problems.push(`${file}: no docs article found`);
  const page = urlOf(file);
  for (const [, href] of article.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith('#')) {
      if (!idsOf(file).has(decodeURIComponent(href.slice(1)))) problems.push(`${page}: missing anchor ${href}`);
      continue;
    }
    if (!href.startsWith('/docs')) continue;
    const [pathname, hash] = href.split('#');
    const target = fileFor(pathname);
    if (!target) {
      problems.push(`${page}: broken link ${href}`);
      continue;
    }
    if (hash && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(hash))) {
      problems.push(`${page}: missing anchor ${href}`);
    }
  }
}

const slugs = (lang) =>
  new Set(
    pages
      .map((file) => urlOf(file).replace(/^\/docs/, ''))
      .filter((path) => (lang === 'zh' ? path === '/zh' || path.startsWith('/zh/') : !(path === '/zh' || path.startsWith('/zh/'))))
      .map((path) => (lang === 'zh' ? path.replace(/^\/zh/, '') : path) || '/'),
  );
const en = slugs('en');
const zh = slugs('zh');
for (const slug of en) if (!zh.has(slug)) problems.push(`no Chinese page for /docs${slug === '/' ? '' : slug}`);
for (const slug of zh) if (!en.has(slug)) problems.push(`no English page for /docs/zh${slug === '/' ? '' : slug}`);

console.log(`${pages.length} docs pages checked`);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('all links and anchors resolve');
