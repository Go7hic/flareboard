import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import { createSurveySchema, updateSurveySchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import { getFeedbackInbox, getSurveyResponses, getSurveySummary } from '../lib/surveys';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;

const surveyTemplates = {
  nps: {
    name: 'Net promoter score',
    question: 'How likely are you to recommend us to a friend or colleague?',
    type: 'choice',
    options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  },
  csat: {
    name: 'Customer satisfaction',
    question: 'How satisfied are you with your experience?',
    type: 'rating',
    options: [],
  },
} as const;

function serialize(row: typeof schema.survey.$inferSelect) {
  return {
    id: row.surveyId,
    websiteId: row.websiteId,
    name: row.name,
    question: row.question,
    type: row.type,
    options: Array.isArray(row.options) ? row.options : [],
    enabled: row.enabled,
    triggerPath: row.triggerPath ?? undefined,
    triggerEvent: row.triggerEvent ?? undefined,
    displayDelaySeconds: row.displayDelaySeconds ?? 0,
    displayRules: Array.isArray(row.displayRules) ? row.displayRules : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getSurvey(env: Env, websiteId: string, surveyId: string) {
  const db = createDb(env.DB);
  const [row] = await db.select().from(schema.survey).where(eq(schema.survey.surveyId, surveyId)).limit(1);
  if (!row || row.websiteId !== websiteId) return null;
  return row;
}

export async function handleList(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.survey)
    .where(eq(schema.survey.websiteId, website!.websiteId))
    .orderBy(schema.survey.createdAt);

  const summaries = await Promise.all(
    rows.map((row) => getSurveySummary(c.env, website!.websiteId, row.surveyId)),
  );
  return json(rows.map((row, index) => ({ ...serialize(row), summary: summaries[index] })));
}

export async function handleCreate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = createSurveySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);
  const template = parsed.data.template ? surveyTemplates[parsed.data.template] : null;
  const name = parsed.data.name ?? template?.name;
  const question = parsed.data.question ?? template?.question;
  const type = template?.type ?? parsed.data.type;
  const options = parsed.data.options.length ? parsed.data.options : [...(template?.options ?? parsed.data.options)];
  if (!name || !question) return badRequest('Survey name and question are required');
  if (type === 'choice' && options.length < 2) {
    return badRequest('Choice surveys require at least two options');
  }

  const now = new Date();
  const surveyId = uuid();
  const db = createDb(c.env.DB);
  await db.insert(schema.survey).values({
    surveyId,
    websiteId: website!.websiteId,
    name,
    question,
    type,
    options,
    enabled: parsed.data.enabled,
    triggerPath: parsed.data.triggerPath ?? null,
    triggerEvent: parsed.data.triggerEvent ?? null,
    displayDelaySeconds: parsed.data.displayDelaySeconds,
    displayRules: parsed.data.displayRules,
    createdAt: now,
    updatedAt: now,
  });
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  const row = await getSurvey(c.env, website!.websiteId, surveyId);
  return json(serialize(row!), 201);
}

export async function handleUpdate(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const row = await getSurvey(c.env, website!.websiteId, c.req.param('surveyId') ?? '');
  if (!row) return notFound();

  const body = await c.req.json().catch(() => null);
  const parsed = updateSurveySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const nextType = parsed.data.type ?? row.type;
  const nextOptions = parsed.data.options ?? (Array.isArray(row.options) ? row.options : []);
  const nextDisplayRules = parsed.data.displayRules ?? (Array.isArray(row.displayRules) ? row.displayRules : []);
  if (nextType === 'choice' && nextOptions.length < 2) {
    return badRequest('Choice surveys require at least two options');
  }

  const db = createDb(c.env.DB);
  await db
    .update(schema.survey)
    .set({
      name: parsed.data.name ?? row.name,
      question: parsed.data.question ?? row.question,
      type: nextType,
      options: nextOptions,
      enabled: parsed.data.enabled ?? row.enabled,
      triggerPath:
        parsed.data.triggerPath !== undefined ? parsed.data.triggerPath : row.triggerPath,
      triggerEvent:
        parsed.data.triggerEvent !== undefined ? parsed.data.triggerEvent : row.triggerEvent,
      displayDelaySeconds: parsed.data.displayDelaySeconds ?? row.displayDelaySeconds,
      displayRules: nextDisplayRules,
      updatedAt: new Date(),
    })
    .where(eq(schema.survey.surveyId, row.surveyId));
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  const updated = await getSurvey(c.env, website!.websiteId, row.surveyId);
  return json(serialize(updated!));
}

export async function handleDelete(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  if (!(await canMutateWebsite(c.env, website!, c.get('user')))) {
    return json({ message: 'Read-only access' }, 403);
  }
  const row = await getSurvey(c.env, website!.websiteId, c.req.param('surveyId') ?? '');
  if (!row) return notFound();
  const db = createDb(c.env.DB);
  await db.delete(schema.survey).where(eq(schema.survey.surveyId, row.surveyId));
  await c.env.CACHE.delete(`tracker-config:${website!.websiteId}`);
  return json({ ok: true });
}

export async function handleResponses(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getSurvey(c.env, website!.websiteId, c.req.param('surveyId') ?? '');
  if (!row) return notFound();
  const filters = {
    answer: c.req.query('answer')?.trim() || undefined,
    path: c.req.query('path')?.trim() || undefined,
    search: c.req.query('q')?.trim() || undefined,
  };
  const [summary, responses] = await Promise.all([
    getSurveySummary(c.env, website!.websiteId, row.surveyId, filters),
    getSurveyResponses(c.env, website!.websiteId, row.surveyId, 100, filters),
  ]);
  return json({ survey: serialize(row), summary, responses });
}

export async function handleFeedback(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const sentiment = c.req.query('sentiment')?.trim();
  const theme = c.req.query('theme')?.trim();
  const search = c.req.query('q')?.trim();
  const inbox = await getFeedbackInbox(c.env, website!.websiteId, {
    sentiment: sentiment === 'positive' || sentiment === 'negative' || sentiment === 'neutral' ? sentiment : undefined,
    theme:
      theme === 'price' ||
      theme === 'bug' ||
      theme === 'confusion' ||
      theme === 'feature_request' ||
      theme === 'support' ||
      theme === 'performance' ||
      theme === 'other'
        ? theme
        : undefined,
    search: search || undefined,
  });
  return json(inbox);
}
