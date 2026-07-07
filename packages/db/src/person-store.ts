export type PersonProperties = Record<string, unknown>;

export function parsePersonProperties(raw: string | null | undefined): PersonProperties {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PersonProperties) : {};
  } catch {
    return {};
  }
}

export function mergePersonProperties(
  existing: PersonProperties,
  patch: PersonProperties,
): PersonProperties {
  return { ...existing, ...patch };
}

export function personPropertyString(properties: PersonProperties, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export async function upsertPerson(
  db: D1Database,
  input: {
    websiteId: string;
    distinctId: string;
    properties?: PersonProperties;
    seenAt: number;
    personId?: string;
  },
): Promise<string> {
  const distinctId = input.distinctId.trim();
  if (!distinctId) throw new Error('distinctId required');

  const existing = await db
    .prepare(
      `SELECT person_id as personId, properties_json as propertiesJson
       FROM person
       WHERE website_id = ?1 AND distinct_id = ?2
       LIMIT 1`,
    )
    .bind(input.websiteId, distinctId)
    .first<{ personId: string; propertiesJson: string }>();

  const personId = existing?.personId ?? input.personId ?? crypto.randomUUID();
  const properties = mergePersonProperties(
    parsePersonProperties(existing?.propertiesJson),
    input.properties ?? {},
  );
  const now = input.seenAt;

  if (existing) {
    const existingRow = await db
      .prepare(`SELECT last_seen_at as lastSeenAt FROM person WHERE person_id = ?1 LIMIT 1`)
      .bind(personId)
      .first<{ lastSeenAt: number | null }>();
    const lastSeenAt = Math.max(existingRow?.lastSeenAt ?? 0, now);
    await db
      .prepare(
        `UPDATE person
         SET properties_json = ?3,
             last_seen_at = ?4,
             updated_at = ?5
         WHERE person_id = ?1 AND website_id = ?2`,
      )
      .bind(personId, input.websiteId, JSON.stringify(properties), lastSeenAt, now)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO person
         (person_id, website_id, distinct_id, properties_json, first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?5)`,
      )
      .bind(personId, input.websiteId, distinctId, JSON.stringify(properties), now)
      .run();
  }

  return personId;
}

export async function patchPersonProperties(
  db: D1Database,
  websiteId: string,
  distinctId: string,
  properties: PersonProperties,
  now = Date.now(),
): Promise<{ personId: string; properties: PersonProperties } | null> {
  const existing = await db
    .prepare(
      `SELECT person_id as personId, properties_json as propertiesJson
       FROM person
       WHERE website_id = ?1 AND distinct_id = ?2
       LIMIT 1`,
    )
    .bind(websiteId, distinctId)
    .first<{ personId: string; propertiesJson: string }>();

  const merged = mergePersonProperties(parsePersonProperties(existing?.propertiesJson), properties);

  if (existing) {
    await db
      .prepare(
        `UPDATE person
         SET properties_json = ?3, updated_at = ?4
         WHERE person_id = ?1 AND website_id = ?2`,
      )
      .bind(existing.personId, websiteId, JSON.stringify(merged), now)
      .run();
    return { personId: existing.personId, properties: merged };
  }

  const personId = await upsertPerson(db, { websiteId, distinctId, properties: merged, seenAt: now });
  return { personId, properties: merged };
}

export async function upsertPersonGroupMembership(
  db: D1Database,
  input: {
    websiteId: string;
    distinctId: string;
    groupType: string;
    groupKey: string;
    seenAt: number;
  },
): Promise<void> {
  const distinctId = input.distinctId.trim();
  const groupType = input.groupType.trim();
  const groupKey = input.groupKey.trim();
  if (!distinctId || !groupType || !groupKey) return;

  const personId = await upsertPerson(db, {
    websiteId: input.websiteId,
    distinctId,
    seenAt: input.seenAt,
  });

  await db
    .prepare(
      `INSERT OR IGNORE INTO person_group_membership
       (membership_id, website_id, person_id, group_type, group_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), input.websiteId, personId, groupType, groupKey, input.seenAt)
    .run();
}
