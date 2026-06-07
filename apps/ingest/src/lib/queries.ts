import { eq, and, isNull } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import type { Env } from '../env';

export async function getWebsiteById(env: Env, websiteId: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.website)
    .where(and(eq(schema.website.websiteId, websiteId), isNull(schema.website.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLinkBySlug(env: Env, slug: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.link)
    .where(and(eq(schema.link.slug, slug), isNull(schema.link.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPixelBySlug(env: Env, slug: string) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.pixel)
    .where(and(eq(schema.pixel.slug, slug), isNull(schema.pixel.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
