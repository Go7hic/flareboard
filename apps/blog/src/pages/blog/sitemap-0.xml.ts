import { getCollection } from 'astro:content';
import { BLOG_BASE } from '../../consts';
import { urlset } from '../../lib/sitemap';

export async function GET(context: { site: URL }) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return urlset([
    { loc: new URL(BLOG_BASE, context.site).href },
    ...posts.map((post) => ({
      loc: new URL(`${BLOG_BASE}/${post.id}`, context.site).href,
      lastmod: post.data.updatedDate ?? post.data.pubDate,
    })),
  ]);
}
