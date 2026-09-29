import { patchPersonProperties, upsertPerson } from '@flareboard/db';
import type { Env } from '../env';

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
  await upsertPerson(env.DB, { websiteId, distinctId: canonicalDistinctId, seenAt });
  await patchPersonProperties(env.DB, websiteId, canonicalDistinctId, { $alias: alias }, seenAt);
  await upsertPerson(env.DB, {
    websiteId,
    distinctId: alias,
    properties: { $alias: alias, $canonical_distinct_id: canonicalDistinctId },
    seenAt,
  });
}
