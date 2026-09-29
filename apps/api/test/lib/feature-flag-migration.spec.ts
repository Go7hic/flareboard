import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const migration = Object.values(
  import.meta.glob('../../../../packages/db/migrations/0045_feature_flag_condition_groups.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
)[0];

/** The data step of migration 0045 (its ALTERs already ran with the other migrations). */
function backfillStatement() {
  const statement = migration
    .split(';')
    .map((part) =>
      part
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .find((part) => part.startsWith('UPDATE'));
  if (!statement) throw new Error('backfill UPDATE not found in migration 0045');
  return statement;
}

async function insertLegacyFlag(id: string, key: string, rollout: number | null, targetingRules: string | null) {
  await env.DB.prepare(
    `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, targeting_rules, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?3, '', 1, COALESCE(?4, 100), ?5, 0, 0)`,
  )
    .bind(id, TEST_WEBSITE_ID, key, rollout, targetingRules)
    .run();
}

async function groupsOf(id: string) {
  const row = await env.DB.prepare(`SELECT condition_groups AS groups FROM feature_flag WHERE flag_id = ?1`)
    .bind(id)
    .first<{ groups: string | null }>();
  return row?.groups ? JSON.parse(row.groups) : null;
}

describe('migration 0045: existing flags become one condition group', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('moves targeting rules and rollout into a single group and leaves migrated rows alone', async () => {
    const rules = [{ field: 'path', operator: 'contains', value: '/pricing' }];
    await insertLegacyFlag('mig-rules', 'mig.rules', 35, JSON.stringify(rules));
    await insertLegacyFlag('mig-none', 'mig.none', 100, null);
    await insertLegacyFlag('mig-bad-json', 'mig.bad', 250, '[{"field":');
    await insertLegacyFlag('mig-object', 'mig.object', 10, '{"field":"path"}');
    await env.DB.prepare(
      `INSERT INTO feature_flag (flag_id, website_id, key, name, description, enabled, rollout, condition_groups, created_at, updated_at)
       VALUES ('mig-done', ?1, 'mig.done', 'done', '', 1, 5, ?2, 0, 0)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify([{ conditions: [], rollout: 5 }, { conditions: [], rollout: 50 }]))
      .run();

    await env.DB.prepare(backfillStatement()).run();

    expect(await groupsOf('mig-rules')).toEqual([{ conditions: rules, rollout: 35 }]);
    expect(await groupsOf('mig-none')).toEqual([{ conditions: [], rollout: 100 }]);
    expect(await groupsOf('mig-bad-json')).toEqual([{ conditions: [], rollout: 100 }]);
    expect(await groupsOf('mig-object')).toEqual([{ conditions: [], rollout: 10 }]);
    expect(await groupsOf('mig-done')).toEqual([
      { conditions: [], rollout: 5 },
      { conditions: [], rollout: 50 },
    ]);

    // Running it again changes nothing.
    await env.DB.prepare(backfillStatement()).run();
    expect(await groupsOf('mig-rules')).toEqual([{ conditions: rules, rollout: 35 }]);
  });
});
