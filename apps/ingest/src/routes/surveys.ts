import type { Context } from 'hono';
import {
  primarySurveyAnswer,
  sanitizeSurveyAnswer,
  sanitizeSurveyAnswers,
  submitSurveyResponseSchema,
  uuid,
  walkSurvey,
  type SurveyAnswers,
} from '@flareboard/shared';
import type { Env } from '../env';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { badRequest, json, notFound } from '../lib/response';
import { getWebsiteById } from '../lib/queries';
import {
  publicAppearance,
  surveyClosedReason,
  surveyRowQuestions,
  SURVEY_COLUMNS,
  type SurveyDbRow,
} from '../lib/surveys';
import { getTrackerConfigJson } from './tracker-config';

type Ctx = Context<{ Bindings: Env }>;

/** Ten questions of at most 2 KB each fit comfortably. */
const MAX_BODY_BYTES = 32 * 1024;

function closedResponse() {
  return json({ message: 'This survey is closed.' }, 409);
}

/**
 * POST /api/surveys/response — one survey submission from the tracker, the hosted survey page
 * or a headless client. Accepts the legacy `answer` string or structured `answers`. A partial
 * submission (`completed: false`) with a client `responseId` can be completed later by posting
 * the remaining answers with the same id.
 */
export async function handleSurveyResponse(c: Ctx) {
  const trustedIp = getTrustedClientIp(c.req.raw);
  const rateLimit = await checkIpRateLimit(c.env, 'survey-response', trustedIp, 30, 60);
  if (!rateLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const text = await c.req.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return json({ message: 'Payload too large' }, 413);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const parsed = submitSurveyResponseSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.issues.map((issue) => issue.message).join('; '));
  const input = parsed.data;

  const perSurveyLimit = await checkIpRateLimit(
    c.env,
    `survey-response:${input.website}:${input.surveyId}`,
    trustedIp,
    5,
    3600,
  );
  if (!perSurveyLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const website = await getWebsiteById(c.env, input.website);
  if (!website) return badRequest('Website not found.');

  const survey = await c.env.DB.prepare(
    `SELECT ${SURVEY_COLUMNS} FROM survey WHERE website_id = ?1 AND survey_id = ?2 AND enabled = 1 LIMIT 1`,
  )
    .bind(input.website, input.surveyId)
    .first<SurveyDbRow>();
  if (!survey) return badRequest('Survey not found.');
  if (input.source === 'hosted' && !survey.hostedEnabled) return badRequest('Survey not found.');

  const questions = surveyRowQuestions(survey);
  let answers: SurveyAnswers;
  if (input.answers) {
    answers = sanitizeSurveyAnswers(questions, input.answers);
  } else {
    // Legacy trackers post one string for the first question.
    const value = questions[0] ? sanitizeSurveyAnswer(questions[0], input.answer) : undefined;
    answers = value === undefined ? {} : { [questions[0].id]: value };
  }
  if (!Object.keys(answers).length) return badRequest('No valid answers for this survey.');

  const now = Date.now();
  const existing = input.responseId
    ? await c.env.DB.prepare(
        'SELECT survey_id as surveyId, website_id as websiteId, completed, answers FROM survey_response WHERE response_id = ?1',
      )
        .bind(input.responseId)
        .first<{ surveyId: string; websiteId: string; completed: number; answers: string | null }>()
    : null;

  if (existing) {
    if (existing.surveyId !== survey.id || existing.websiteId !== survey.websiteId) {
      return json({ message: 'Response id already used.' }, 409);
    }
    if (existing.completed) return json({ message: 'Response already submitted.' }, 409);
    // Completing a partial response: later answers win, earlier ones are kept.
    const merged = { ...sanitizeSurveyAnswers(questions, existing.answers), ...answers };
    const completed = input.completed !== false && walkSurvey(questions, merged).completed;
    await c.env.DB.prepare(
      `UPDATE survey_response
       SET answers = ?2, answer = ?3, completed = ?4, updated_at = ?5,
           session_id = COALESCE(session_id, ?6), visit_id = COALESCE(visit_id, ?7),
           distinct_id = COALESCE(?8, distinct_id), url_path = COALESCE(url_path, ?9)
       WHERE response_id = ?1 AND completed = 0`,
    )
      .bind(
        input.responseId,
        JSON.stringify(merged),
        primarySurveyAnswer(questions, merged),
        completed ? 1 : 0,
        now,
        input.sessionId ?? null,
        input.visitId ?? null,
        input.distinctId ?? null,
        input.urlPath ?? null,
      )
      .run();
    return json({ ok: true, responseId: input.responseId, completed });
  }

  // New responses respect the schedule and the response limit. Completing a response that
  // started before the survey closed (the branch above) is still allowed.
  if (await surveyClosedReason(c.env, survey, now)) return closedResponse();

  const completed = input.completed !== false && walkSurvey(questions, answers).completed;
  const responseId = input.responseId ?? uuid();
  try {
    await c.env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, distinct_id, answer, answers,
                                    completed, source, url_path, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
    )
      .bind(
        responseId,
        survey.id,
        survey.websiteId,
        input.sessionId ?? null,
        input.visitId ?? null,
        input.distinctId ?? null,
        primarySurveyAnswer(questions, answers),
        JSON.stringify(answers),
        completed ? 1 : 0,
        input.source ?? 'widget',
        input.urlPath ?? null,
        now,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE|PRIMARY KEY/i.test(error.message)) {
      return json({ message: 'Response id already used.' }, 409);
    }
    throw error;
  }

  return json({ ok: true, responseId, completed });
}

/**
 * GET /api/surveys?website=<id> — headless API: the active surveys for a website, in the same
 * shape as `surveys` in /api/tracker-config (schedule and response limits already applied).
 */
export async function handleActiveSurveys(c: Ctx) {
  const websiteId = c.req.query('website');
  if (!websiteId) return badRequest('website query param required');
  const body = await getTrackerConfigJson(c.env, websiteId);
  if (!body) return notFound();
  const config = JSON.parse(body) as { surveys?: unknown[] };
  return new Response(JSON.stringify({ surveys: config.surveys ?? [] }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
}

/**
 * GET /api/surveys/hosted/:key — the public definition behind a hosted survey link
 * (/s/<surveyId or slug> on the dashboard). Only surveys with hosting enabled resolve.
 * `closed` is set (and questions omitted) when the survey is disabled, outside its schedule
 * or has reached its response limit.
 */
export async function handleHostedSurvey(c: Ctx) {
  const trustedIp = getTrustedClientIp(c.req.raw);
  const rateLimit = await checkIpRateLimit(c.env, 'survey-hosted', trustedIp, 60, 60);
  if (!rateLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const key = (c.req.param('key') ?? '').trim();
  if (!key || key.length > 64) return notFound();
  const survey = await c.env.DB.prepare(
    `SELECT ${SURVEY_COLUMNS} FROM survey WHERE (survey_id = ?1 OR slug = ?2) AND hosted_enabled = 1 LIMIT 1`,
  )
    .bind(key, key.toLowerCase())
    .first<SurveyDbRow>();
  if (!survey) return notFound();
  const website = await getWebsiteById(c.env, survey.websiteId);
  if (!website) return notFound();

  const closedReason = await surveyClosedReason(c.env, survey);
  return new Response(
    JSON.stringify({
      id: survey.id,
      websiteId: survey.websiteId,
      name: survey.name,
      closed: Boolean(closedReason),
      questions: closedReason ? [] : surveyRowQuestions(survey),
      appearance: publicAppearance(survey.appearance),
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}
