/** A urlset sitemap for absolute URLs. */
export function urlset(urls: { loc: string; lastmod?: Date }[]) {
  const items = urls
    .map(({ loc, lastmod }) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`)
    .join('\n');
  return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`);
}

/** A sitemap index pointing at other sitemaps. */
export function sitemapIndex(locs: string[]) {
  const items = locs.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join('\n');
  return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>`);
}

function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
