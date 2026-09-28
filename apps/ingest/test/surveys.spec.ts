import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from './helpers/migrations';
import { fetchWorker, fetchWorkerJson } from './helpers/fetch-worker';

const QUESTIONS = [
  {
    id: 'nps',
    type: 'rating',
    scale: 'nps',
    question: 'How likely are you to recommend us?',
    branching: [{ when: { type: 'range', min: 9, max: 10 }, next: 'end' }],
  },
  { id: 'why', type: 'open', question: 'What should we improve?' },
  { id: 'plan', type: 'multiple_choice', question: 'Plans?', options: ['Free', 'Pro'], hasOther: true, optional: true },
];

let ipCounter = 0;
/** A fresh client IP per request keeps the per-IP survey rate limits out of the way. */
function headers() {
  ipCounter += 1;
  return { 'Content-Type': 'application/json', 'cf-connecting-ip': `203.0.113.${ipCounter}` };
}

async function insertSurvey(
  id: string,
  overrides: Partial<Record<'enabled' | 'responseLimit' | 'startsAt' | 'endsAt' | 'hostedEnabled' | 'slug' | 'appearance', unknown>> = {},
) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO survey (survey_id, website_id, name, question, type, options, questions, appearance, enabled, sample_rate,
                         response_limit, starts_at, ends_at, repeat_interval_days, hosted_enabled, slug, created_at, updated_at)
     VALUES (?1, ?2, ?1, 'How likely are you to recommend us?', 'choice', ?3, ?4, ?5, ?6, 40, ?7, ?8, ?9, 30, ?10, ?11, ?12, ?12)`,
  )
    .bind(
      id,
      TEST_WEBSITE_ID,
      JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']),
      JSON.stringify(QUESTIONS),
      overrides.appearance === undefined ? null : JSON.stringify(overrides.appearance),
      overrides.enabled === false ? 0 : 1,
      overrides.responseLimit ?? null,
      overrides.startsAt ?? null,
      overrides.endsAt ?? null,
      overrides.hostedEnabled ? 1 : 0,
      overrides.slug ?? null,
      now,
    )
    .run();
}

async function submit(body: Record<string, unknown>) {
  return fetchWorkerJson<{ ok?: boolean; responseId?: string; completed?: boolean; message?: string }>(
    '/api/surveys/response',
    { method: 'POST', headers: headers(), body: JSON.stringify({ website: TEST_WEBSITE_ID, ...body }) },
  );
}

async function storedResponse(id: string) {
  return env.DB.prepare(
    `SELECT answer, answers, completed, source, distinct_id as distinctId FROM survey_response WHERE response_id = ?1`,
  )
    .bind(id)
    .first<{ answer: string; answers: string; completed: number; source: string; distinctId: string | null }>();
}

describe('survey config for trackers and headless clients', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const now = Date.now();
    await insertSurvey('cfg-active', { appearance: { accent: 'blue', position: 'top-left' } });
    await insertSurvey('cfg-future', { startsAt: now + 60_000 });
    await insertSurvey('cfg-ended', { endsAt: now - 1 });
    await insertSurvey('cfg-full', { responseLimit: 1 });
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, answer, completed, created_at)
       VALUES ('cfg-full-r1', 'cfg-full', ?1, '9', 1, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, now)
      .run();
    await env.CACHE.delete(`tracker-config:${TEST_WEBSITE_ID}`);
  });

  it('lists multi-question surveys with legacy fields, appearance colors and targeting', async () => {
    const { response, body } = await fetchWorkerJson<{ surveys: Array<Record<string, any>> }>(
      `/api/tracker-config?website=${TEST_WEBSITE_ID}`,
    );
    expect(response.status).toBe(200);
    const ids = body.surveys.map((survey) => survey.id);
    expect(ids).toContain('cfg-active');
    expect(ids).not.toContain('cfg-future');
    expect(ids).not.toContain('cfg-ended');
    expect(ids).not.toContain('cfg-full');

    const survey = body.surveys.find((item) => item.id === 'cfg-active')!;
    expect(survey).toMatchObject({
      question: 'How likely are you to recommend us?',
      type: 'choice',
      options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      version: 2,
      sampleRate: 40,
      repeatIntervalDays: 30,
      appearance: { accent: 'blue', position: 'top-left', theme: 'auto' },
    });
    expect(survey.questions.map((question: { id: string }) => question.id)).toEqual(['nps', 'why', 'plan']);
    expect(survey.appearance.colors.light.accent).toBe('#006bff');
    expect(survey.appearance.colors.dark).toMatchObject({ background: '#0a0a0a' });
  });

  it('serves the same surveys from the headless endpoint', async () => {
    const { response, body } = await fetchWorkerJson<{ surveys: Array<{ id: string }> }>(
      `/api/surveys?website=${TEST_WEBSITE_ID}`,
    );
    expect(response.status).toBe(200);
    expect(body.surveys.map((survey) => survey.id)).toContain('cfg-active');
    expect((await fetchWorker('/api/surveys')).status).toBe(400);
    expect((await fetchWorker('/api/surveys?website=00000000-0000-0000-0000-00000000dead')).status).toBe(404);
  });
});

describe('POST /api/surveys/response', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSurvey('resp-survey');
    await insertSurvey('resp-limited', { responseLimit: 1 });
    await insertSurvey('resp-ended', { endsAt: Date.now() - 1000 });
  });

  it('stores structured answers and marks a finished path complete', async () => {
    const { response, body } = await submit({
      surveyId: 'resp-survey',
      answers: { nps: 10, why: 'ignored? no, kept', unknown: 'dropped' },
      distinctId: 'user-1',
    });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, completed: true });
    const row = await storedResponse(body.responseId!);
    expect(JSON.parse(row!.answers)).toEqual({ nps: 10, why: 'ignored? no, kept' });
    expect(row).toMatchObject({ answer: '10', completed: 1, source: 'widget', distinctId: 'user-1' });
  });

  it('records a partial response when a required question on the path is missing', async () => {
    const { body } = await submit({ surveyId: 'resp-survey', answers: { nps: 4 }, completed: false });
    expect(body.completed).toBe(false);
    expect((await storedResponse(body.responseId!))!.completed).toBe(0);

    // Claiming completion does not override the survey definition.
    const claimed = await submit({ surveyId: 'resp-survey', answers: { nps: 4 }, completed: true });
    expect(claimed.body.completed).toBe(false);
  });

  it('accepts the legacy single answer string for the first question', async () => {
    const promoter = await submit({ surveyId: 'resp-survey', answer: '9' });
    expect(promoter.body.completed).toBe(true);
    expect(JSON.parse((await storedResponse(promoter.body.responseId!))!.answers)).toEqual({ nps: 9 });

    const detractor = await submit({ surveyId: 'resp-survey', answer: '2' });
    expect(detractor.body.completed).toBe(false);

    const invalid = await submit({ surveyId: 'resp-survey', answer: 'not a score' });
    expect(invalid.response.status).toBe(400);
  });

  it('completes a partial response with the same response id instead of adding a row', async () => {
    const responseId = crypto.randomUUID();
    const partial = await submit({ surveyId: 'resp-survey', responseId, answers: { nps: 3 }, completed: false });
    expect(partial.body).toMatchObject({ responseId, completed: false });

    const done = await submit({ surveyId: 'resp-survey', responseId, answers: { why: 'Faster exports', plan: ['Pro', 'Team'] } });
    expect(done.response.status).toBe(200);
    expect(done.body).toMatchObject({ responseId, completed: true });
    const row = await storedResponse(responseId);
    expect(JSON.parse(row!.answers)).toEqual({ nps: 3, why: 'Faster exports', plan: ['Pro', 'Team'] });
    expect(row!.completed).toBe(1);

    const again = await submit({ surveyId: 'resp-survey', responseId, answers: { why: 'Overwrite' } });
    expect(again.response.status).toBe(409);
    const count = await env.DB.prepare(`SELECT COUNT(*) as n FROM survey_response WHERE response_id = ?1`)
      .bind(responseId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('does not let a response id move between surveys', async () => {
    const responseId = crypto.randomUUID();
    await submit({ surveyId: 'resp-survey', responseId, answers: { nps: 3 }, completed: false });
    const moved = await submit({ surveyId: 'resp-limited', responseId, answers: { nps: 3 } });
    expect(moved.response.status).toBe(409);
  });

  it('stops accepting new responses after the limit or the end date', async () => {
    const first = await submit({ surveyId: 'resp-limited', answers: { nps: 10 } });
    expect(first.response.status).toBe(200);
    const second = await submit({ surveyId: 'resp-limited', answers: { nps: 10 } });
    expect(second.response.status).toBe(409);

    const ended = await submit({ surveyId: 'resp-ended', answers: { nps: 10 } });
    expect(ended.response.status).toBe(409);
  });

  it('rejects bodies without valid answers and oversized payloads', async () => {
    expect((await submit({ surveyId: 'resp-survey', answers: { nps: 42 } })).response.status).toBe(400);
    expect((await submit({ surveyId: 'resp-survey', answers: {} })).response.status).toBe(400);
    const huge = await fetchWorker('/api/surveys/response', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ website: TEST_WEBSITE_ID, surveyId: 'resp-survey', answers: { why: 'x'.repeat(40_000) } }),
    });
    expect(huge.status).toBe(413);
  });
});

describe('hosted surveys', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    await insertSurvey('hosted-open', { hostedEnabled: true, slug: 'beta-feedback' });
    await insertSurvey('hosted-off');
    await insertSurvey('hosted-closed', { hostedEnabled: true, endsAt: Date.now() - 1000 });
  });

  it('resolves hosted surveys by slug or id', async () => {
    const bySlug = await fetchWorkerJson<{ id: string; closed: boolean; questions: unknown[]; appearance: { colors: unknown } }>(
      '/api/surveys/hosted/Beta-Feedback',
      { headers: headers() },
    );
    expect(bySlug.response.status).toBe(200);
    expect(bySlug.body).toMatchObject({ id: 'hosted-open', closed: false });
    expect(bySlug.body.questions).toHaveLength(3);
    expect(bySlug.body.appearance.colors).toBeTruthy();

    const byId = await fetchWorker('/api/surveys/hosted/hosted-open', { headers: headers() });
    expect(byId.status).toBe(200);
  });

  it('hides surveys without hosting and reports closed ones', async () => {
    expect((await fetchWorker('/api/surveys/hosted/hosted-off', { headers: headers() })).status).toBe(404);
    const closed = await fetchWorkerJson<{ closed: boolean; questions: unknown[] }>('/api/surveys/hosted/hosted-closed', {
      headers: headers(),
    });
    expect(closed.body).toEqual(expect.objectContaining({ closed: true, questions: [] }));
  });

  it('accepts hosted submissions only for hosted surveys', async () => {
    const ok = await submit({ surveyId: 'hosted-open', source: 'hosted', answers: { nps: 10 } });
    expect(ok.response.status).toBe(200);
    expect((await storedResponse(ok.body.responseId!))!.source).toBe('hosted');

    const off = await submit({ surveyId: 'hosted-off', source: 'hosted', answers: { nps: 10 } });
    expect(off.response.status).toBe(400);
  });
});
