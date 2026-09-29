import { patchPersonProperties, upsertPerson } from '@flareboard/db';
import type { Env } from '../env';
import { writeSiteTables } from './site-db';

/**
 * Links `alias` to the canonical distinct id: the canonical person records the alias, and the
 * alias gets its own person row pointing back. (Reusing the canonical person_id, the primary
 * key, for the alias row made this insert fail every time.)
 */
export async function recordAlias(
  env: Env,
  input: { websiteId: string; alias: string; canonicalDistinctId: string; seenAt: number },
): Promise<void> {
  const { websiteId, alias, canonicalDistinctId, seenAt } = input;
  await writeSiteTables(env, websiteId, async (db) => {
    await upsertPerson(db, { websiteId, distinctId: canonicalDistinctId, seenAt });
    await patchPersonProperties(db, websiteId, canonicalDistinctId, { $alias: alias }, seenAt);
    await upsertPerson(db, {
      websiteId,
      distinctId: alias,
      properties: { $alias: alias, $canonical_distinct_id: canonicalDistinctId },
      seenAt,
    });
  });
}
