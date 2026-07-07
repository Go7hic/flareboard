import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { listAnnotations, serializeAnnotation } from '../../src/lib/annotations';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 0, 18, 12);

async function insertAnnotation(
  id: string,
  title: string,
  category: string,
  happenedAt: number,
  description = '',
) {
  await env.DB.prepare(
    `INSERT INTO annotation
     (annotation_id, website_id, user_id, title, description, category, happened_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)`,
  )
    .bind(id, TEST_WEBSITE_ID, TEST_USER_ID, title, description, category, happenedAt)
    .run();
}

describe('annotation query helpers', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('lists annotations in range ordered by happened time', async () => {
    await insertAnnotation('annotation-1', 'Launched checkout redesign', 'release', BASE + 1000);
    await insertAnnotation('annotation-2', 'Partner campaign started', 'campaign', BASE + 2000);
    await insertAnnotation('annotation-old', 'Old incident', 'incident', BASE - 10_000);

    const annotations = await listAnnotations(env, TEST_WEBSITE_ID, BASE, BASE + 3000);

    expect(annotations.map((annotation) => annotation.annotationId)).toEqual([
      'annotation-2',
      'annotation-1',
    ]);
    expect(annotations[0]).toMatchObject({
      title: 'Partner campaign started',
      category: 'campaign',
      happenedAt: BASE + 2000,
    });
  });

  it('serializes timestamp values consistently', () => {
    const serialized = serializeAnnotation({
      annotationId: 'annotation-date',
      websiteId: TEST_WEBSITE_ID,
      userId: TEST_USER_ID,
      title: 'Incident resolved',
      description: 'Error rate returned to normal.',
      category: 'incident',
      happenedAt: new Date(BASE),
      createdAt: new Date(BASE + 1),
      updatedAt: null,
    });

    expect(serialized).toMatchObject({
      id: 'annotation-date',
      happenedAt: BASE,
      createdAt: BASE + 1,
      updatedAt: null,
    });
  });
});
