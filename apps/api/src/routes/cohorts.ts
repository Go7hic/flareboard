import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  createCohortSchema,
  statsQuerySchema,
  updateCohortSchema,
  uuid,
  type CohortDefinition,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canAccessWebsite, canMutateWebsite } from '../lib/access';
import {
  compareCohorts,
  getCohortSizeOverTime,
  legacyToDefinition,
  parseCohortDefinition,
} from '../lib/cohorts';
import { getWebsiteById } from '../lib/queries';
import { badRequest, json, notFound } from '../lib/response';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

function serialize(row: typeof schema.cohort.$inferSelect) {
  const definition = parseCohortDefinition(
    row.definition as CohortDefinition | null,
    row.type,
    row.value,
  );
  return {
    id: row.cohortId,
    websiteId: row.websiteId,
    name: row.name,
    definition,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function definitionLegacyFields(definition: CohortDefinition) {
  const first = definition.conditions[0];
  if (!first) return { type: 'event' as const, value: '' };
  if (first.field === 'event_name') return { type: 'event' as const, value: first.value };
  return { type: 'path' as const, value: first.value };
}

async function getCohort(env: Env, websiteId: string, cohortId: string) {
  const db = createDb(env.DB);
  const [row] = await db
    .select()
    .from(schema.cohort)
    .where(eq(schema.cohort.cohortId, cohortId))
    .limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

export async function handleList(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.cohort)
    .where(eq(schema.cohort.websiteId, websiteId));
  return json(rows.map(serialize));
}

export async function handleCreate(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  if (!websiteId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createCohortSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const cohortId = uuid();
  const now = new Date();
  const legacy = definitionLegacyFields(parsed.data.definition);
  const db = createDb(c.env.DB);
  await db.insert(schema.cohort).values({
    cohortId,
    websiteId,
    name: parsed.data.name,
    type: legacy.type,
    value: legacy.value,
    definition: parsed.data.definition,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getCohort(c.env, websiteId, cohortId);
  return json(serialize(row!), 201);
}

export async function handleGet(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  const cohortId = c.req.param('cohortId');
  if (!websiteId || !cohortId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  const row = await getCohort(c.env, websiteId, cohortId);
  if (!row) return notFound();
  return json(serialize(row));
}

export async function handleUpdate(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  const cohortId = c.req.param('cohortId');
  if (!websiteId || !cohortId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const row = await getCohort(c.env, websiteId, cohortId);
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateCohortSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const definition = parsed.data.definition ?? (row.definition as CohortDefinition);
  const legacy = definition ? definitionLegacyFields(definition) : null;

  const db = createDb(c.env.DB);
  await db
    .update(schema.cohort)
    .set({
      name: parsed.data.name ?? row.name,
      definition: parsed.data.definition ?? row.definition,
      type: legacy?.type ?? row.type,
      value: legacy?.value ?? row.value,
      updatedAt: new Date(),
    })
    .where(eq(schema.cohort.cohortId, cohortId));

  const updated = await getCohort(c.env, websiteId, cohortId);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const websiteId = c.req.param('websiteId');
  const cohortId = c.req.param('cohortId');
  if (!websiteId || !cohortId) return notFound();
  const website = await getWebsiteById(c.env, websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }
  if (!(await canMutateWebsite(c.env, website, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }

  const db = createDb(c.env.DB);
  await db.delete(schema.cohort).where(eq(schema.cohort.cohortId, cohortId));
  return json({ ok: true });
}

export async function handleReport(c: Ctx) {
  const cohortId = c.req.query('cohortId');
  const compareId = c.req.query('compareCohortId');
  if (!cohortId) return badRequest('cohortId required');

  const query = statsQuerySchema.safeParse(c.req.query());
  const endAt = query.success && query.data.endAt ? query.data.endAt : Date.now();
  const startAt = query.success && query.data.startAt ? query.data.startAt : endAt - 30 * 24 * 60 * 60 * 1000;

  const db = createDb(c.env.DB);
  const [row] = await db
    .select()
    .from(schema.cohort)
    .where(eq(schema.cohort.cohortId, cohortId))
    .limit(1);
  if (!row) return notFound();

  const website = await getWebsiteById(c.env, row.websiteId);
  if (!website || !(await canAccessWebsite(c.env, website, c.get('user')))) {
    return notFound();
  }

  const definition = parseCohortDefinition(
    row.definition as CohortDefinition | null,
    row.type,
    row.value,
  );
  const cohortRecord = {
    cohortId: row.cohortId,
    websiteId: row.websiteId,
    name: row.name,
    definition,
  };

  if (compareId) {
    const [compareRow] = await db
      .select()
      .from(schema.cohort)
      .where(eq(schema.cohort.cohortId, compareId))
      .limit(1);
    if (!compareRow || compareRow.websiteId !== row.websiteId) return notFound();
    const compareDef = parseCohortDefinition(
      compareRow.definition as CohortDefinition | null,
      compareRow.type,
      compareRow.value,
    );
    const comparison = await compareCohorts(
      c.env,
      cohortRecord,
      {
        cohortId: compareRow.cohortId,
        websiteId: compareRow.websiteId,
        name: compareRow.name,
        definition: compareDef,
      },
      startAt,
      endAt,
    );
    return json(comparison);
  }

  const report = await getCohortSizeOverTime(c.env, cohortRecord, startAt, endAt);
  return json(report);
}
