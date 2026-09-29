import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@flareboard/db';
import {
  createSurveySchema,
  legacySurveyFields,
  legacySurveyQuestion,
  normalizeSurveyAppearance,
  normalizeSurveyQuestions,
  surveyQuestionsSchema,
  updateSurveySchema,
  uuid,
  type SurveyQuestion,
} from '@flareboard/shared';
import type { Env } from '../env';
import { canMutateWebsite } from '../lib/access';
import {
  exportSurveyResponsesCsv,
  getFeedbackInbox,
  getSurveyResponses,
  getSurveyResults,
  getSurveySummary,
  type SurveyResponseFilters,
} from '../lib/surveys';
import { badRequest, json, notFound } from '../lib/response';
import { requireWebsiteOr404 } from '../lib/website';
import type { ApiVariables } from '../middleware/auth';

type Ctx = Context<{ Bindings: Env; Variables: ApiVariables }>;
type SurveyRow = typeof schema.survey.$inferSelect;

const surveyTemplates: Record<'nps' | 'csat', { name: string; questions: SurveyQuestion[] }> = {
  nps: {
    name: 'Net promoter score',
    questions: [
      {
        id: 'q1',
        type: 'rating',
        scale: 'nps',
        question: 'How likely are you to recommend us to a friend or colleague?',
        description: '',
        optional: false,
        buttonText: '',
        branching: [],
        lowerLabel: 'Not likely',
        upperLabel: 'Very likely',
      },
    ],
  },
  csat: {
    name: 'Customer satisfaction',
    questions: [
      {
        id: 'q1',
        type: 'rating',
        scale: 5,
        question: 'How satisfied are you with your experience?',
        description: '',
        optional: false,
        buttonText: '',
        branching: [],
        lowerLabel: 'Very unsatisfied',
        upperLabel: 'Very satisfied',
      },
    ],
  },
};

function surveyQuestions(row: SurveyRow) {
  return normalizeSurveyQuestions({
    questions: row.questions,
    question: row.question,
    type: row.type,
    options: row.options,
  });
}

function serialize(row: SurveyRow) {
  return {
    id: row.surveyId,
    websiteId: row.websiteId,
    name: row.name,
    // Legacy single-question fields: a mirror of the first question.
    question: row.question,
    type: row.type,
    options: Array.isArray(row.options) ? row.options : [],
    questions: surveyQuestions(row),
    appearance: normalizeSurveyAppearance(row.appearance),
    enabled: row.enabled,
    triggerPath: row.triggerPath ?? undefined,
    triggerEvent: row.triggerEvent ?? undefined,
    displayDelaySeconds: row.displayDelaySeconds ?? 0,
    displayRules: Array.isArray(row.displayRules) ? row.displayRules : [],
    sampleRate: row.sampleRate ?? 100,
    responseLimit: row.responseLimit ?? null,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    repeatIntervalDays: row.repeatIntervalDays ?? null,
    hostedEnabled: Boolean(row.hostedEnabled),
    slug: row.slug ?? null,
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

/** Slugs are global (hosted links are /s/<slug>), so they must not collide with any survey. */
async function slugTaken(env: Env, slug: string, surveyId: string | null) {
  const row = await env.DB.prepare('SELECT survey_id as id FROM survey WHERE slug = ?1 AND survey_id != ?2 LIMIT 1')
    .bind(slug, surveyId ?? '')
    .first<{ id: string }>();
  return Boolean(row);
}

function issuesMessage(error: { issues: Array<{ message: string; path: Array<string | number> }> }) {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ');
}

function isUniqueSlugError(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed: survey\.slug/i.test(error.message);
}

async function invalidateTrackerConfig(env: Env, websiteId: string) {
  await env.CACHE.delete(`tracker-config:${websiteId}`);
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
  if (!parsed.success) return badRequest(issuesMessage(parsed.error));
  const data = parsed.data;
  const template = data.template ? surveyTemplates[data.template] : null;
  const name = data.name ?? template?.name;

  let questions: SurveyQuestion[];
  if (data.questions) questions = data.questions;
  else if (template) {
    questions = data.question ? [{ ...template.questions[0], question: data.question }] : template.questions;
  } else if (data.question) {
    if (data.type === 'choice' && data.options.length < 2) {
      return badRequest('Choice surveys require at least two options');
    }
    questions = [legacySurveyQuestion({ question: data.question, type: data.type, options: data.options })];
  } else return badRequest('Survey name and question are required');
  if (!name) return badRequest('Survey name and question are required');

  if (data.slug && (await slugTaken(c.env, data.slug, null))) {
    return json({ message: 'This survey link is already in use' }, 409);
  }

  const legacy = legacySurveyFields(questions);
  const now = new Date();
  const surveyId = uuid();
  const db = createDb(c.env.DB);
  try {
    await db.insert(schema.survey).values({
      surveyId,
      websiteId: website!.websiteId,
      name,
      question: legacy.question,
      type: legacy.type,
      options: legacy.options,
      questions,
      appearance: data.appearance ?? normalizeSurveyAppearance(null),
      enabled: data.enabled,
      triggerPath: data.triggerPath ?? null,
      triggerEvent: data.triggerEvent ?? null,
      displayDelaySeconds: data.displayDelaySeconds,
      displayRules: data.displayRules,
      sampleRate: data.sampleRate ?? 100,
      responseLimit: data.responseLimit ?? null,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
      repeatIntervalDays: data.repeatIntervalDays ?? null,
      hostedEnabled: data.hostedEnabled ?? false,
      slug: data.slug ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueSlugError(error)) return json({ message: 'This survey link is already in use' }, 409);
    throw error;
  }
  await invalidateTrackerConfig(c.env, website!.websiteId);
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
  if (!parsed.success) return badRequest(issuesMessage(parsed.error));
  const data = parsed.data;

  let questions = surveyQuestions(row);
  if (data.questions) {
    questions = data.questions;
  } else if (data.question !== undefined || data.type !== undefined || data.options !== undefined) {
    // Legacy single-question edit: replace the first question, keep the rest.
    const type = data.type ?? row.type;
    const options = data.options ?? (Array.isArray(row.options) ? row.options : []);
    if (type === 'choice' && options.length < 2) {
      return badRequest('Choice surveys require at least two options');
    }
    const first = legacySurveyQuestion({ question: data.question ?? row.question, type, options });
    const merged = surveyQuestionsSchema.safeParse([{ ...first, id: questions[0]?.id ?? first.id }, ...questions.slice(1)]);
    if (!merged.success) return badRequest(issuesMessage(merged.error));
    questions = merged.data;
  }

  const startsAt = data.startsAt !== undefined ? data.startsAt : row.startsAt;
  const endsAt = data.endsAt !== undefined ? data.endsAt : row.endsAt;
  if (startsAt != null && endsAt != null && startsAt >= endsAt) {
    return badRequest('The survey end date must be after its start date');
  }
  const slug = data.slug !== undefined ? data.slug : row.slug;
  if (slug && slug !== row.slug && (await slugTaken(c.env, slug, row.surveyId))) {
    return json({ message: 'This survey link is already in use' }, 409);
  }

  const legacy = legacySurveyFields(questions);
  const db = createDb(c.env.DB);
  try {
    await db
      .update(schema.survey)
      .set({
        name: data.name ?? row.name,
        question: legacy.question,
        type: legacy.type,
        options: legacy.options,
        questions,
        appearance: data.appearance ?? normalizeSurveyAppearance(row.appearance),
        enabled: data.enabled ?? row.enabled,
        triggerPath: data.triggerPath !== undefined ? data.triggerPath : row.triggerPath,
        triggerEvent: data.triggerEvent !== undefined ? data.triggerEvent : row.triggerEvent,
        displayDelaySeconds: data.displayDelaySeconds ?? row.displayDelaySeconds,
        displayRules: data.displayRules ?? (Array.isArray(row.displayRules) ? row.displayRules : []),
        sampleRate: data.sampleRate ?? row.sampleRate,
        responseLimit: data.responseLimit !== undefined ? data.responseLimit : row.responseLimit,
        startsAt,
        endsAt,
        repeatIntervalDays: data.repeatIntervalDays !== undefined ? data.repeatIntervalDays : row.repeatIntervalDays,
        hostedEnabled: data.hostedEnabled ?? row.hostedEnabled,
        slug,
        updatedAt: new Date(),
      })
      .where(eq(schema.survey.surveyId, row.surveyId));
  } catch (error) {
    if (isUniqueSlugError(error)) return json({ message: 'This survey link is already in use' }, 409);
    throw error;
  }
  await invalidateTrackerConfig(c.env, website!.websiteId);
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
  // Responses reference the survey (foreign key), so they go first, in the same batch.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM survey_response WHERE survey_id = ?1 AND website_id = ?2').bind(
      row.surveyId,
      website!.websiteId,
    ),
    c.env.DB.prepare('DELETE FROM survey WHERE survey_id = ?1 AND website_id = ?2').bind(row.surveyId, website!.websiteId),
  ]);
  await invalidateTrackerConfig(c.env, website!.websiteId);
  return json({ ok: true });
}

function optionalTimestamp(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function responseFilters(c: Ctx): SurveyResponseFilters {
  const completion = c.req.query('status');
  return {
    answer: c.req.query('answer')?.trim() || undefined,
    path: c.req.query('path')?.trim() || undefined,
    search: c.req.query('q')?.trim() || undefined,
    from: optionalTimestamp(c.req.query('startAt')),
    to: optionalTimestamp(c.req.query('endAt')),
    completion: completion === 'complete' || completion === 'partial' ? completion : undefined,
  };
}

export async function handleResponses(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getSurvey(c.env, website!.websiteId, c.req.param('surveyId') ?? '');
  if (!row) return notFound();
  const filters = responseFilters(c);
  const questions = surveyQuestions(row);
  const [summary, results, responses] = await Promise.all([
    getSurveySummary(c.env, website!.websiteId, row.surveyId, filters),
    getSurveyResults(c.env, website!.websiteId, row.surveyId, questions, filters),
    getSurveyResponses(c.env, website!.websiteId, row.surveyId, 100, filters, questions),
  ]);
  return json({ survey: serialize(row), summary, results, responses });
}

export async function handleExport(c: Ctx) {
  const { website, response } = await requireWebsiteOr404(c);
  if (response) return response;
  const row = await getSurvey(c.env, website!.websiteId, c.req.param('surveyId') ?? '');
  if (!row) return notFound();
  const csv = await exportSurveyResponsesCsv(
    c.env,
    website!.websiteId,
    row.surveyId,
    surveyQuestions(row),
    responseFilters(c),
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="survey-${row.surveyId}-responses.csv"`,
      'Cache-Control': 'no-store',
    },
  });
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
