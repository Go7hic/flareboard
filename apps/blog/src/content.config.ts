import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Flareboard'),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
});

const docs = defineCollection({
  // Ids keep the path as written (en/index, en/install/script); the default would fold index away.
  loader: glob({ base: './src/content/docs', pattern: '**/*.md', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    title: z.string(),
    /** One or two sentences: the page summary, the meta description and the llms.txt line. */
    description: z.string(),
    /** Shorter label for the sidebar when the title is long. */
    sidebarTitle: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, docs };
