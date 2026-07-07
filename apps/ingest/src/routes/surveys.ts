import type { Context } from 'hono';
import { submitSurveyResponseSchema, uuid } from '@flareboard/shared';
import type { Env } from '../env';
import { checkIpRateLimit, getTrustedClientIp } from '../lib/rate-limit';
import { badRequest, json } from '../lib/response';
import { getWebsiteById } from '../lib/queries';

type Ctx = Context<{ Bindings: Env }>;

export async function handleSurveyResponse(c: Ctx) {
  const trustedIp = getTrustedClientIp(c.req.raw);
  const rateLimit = await checkIpRateLimit(c.env, 'survey-response', trustedIp, 30, 60);
  if (!rateLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const body = await c.req.json().catch(() => null);
  const parsed = submitSurveyResponseSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.message);

  const perSurveyLimit = await checkIpRateLimit(
    c.env,
    `survey-response:${parsed.data.website}:${parsed.data.surveyId}`,
    trustedIp,
    5,
    3600,
  );
  if (!perSurveyLimit.allowed) return json({ message: 'Rate limit exceeded' }, 429);

  const website = await getWebsiteById(c.env, parsed.data.website);
  if (!website) return badRequest('Website not found.');

  const survey = await c.env.DB.prepare(
    `SELECT survey_id as id FROM survey WHERE website_id = ?1 AND survey_id = ?2 AND enabled = 1 LIMIT 1`,
  )
    .bind(parsed.data.website, parsed.data.surveyId)
    .first<{ id: string }>();
  if (!survey) return badRequest('Survey not found.');

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      uuid(),
      parsed.data.surveyId,
      parsed.data.website,
      parsed.data.sessionId ?? null,
      parsed.data.visitId ?? null,
      parsed.data.answer,
      parsed.data.urlPath ?? null,
      now,
    )
    .run();

  return json({ ok: true });
}
