import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSecureToken } from '@flareboard/shared';
import { fetchWorker, fetchWorkerJson } from '../helpers/fetch-worker';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE = Date.UTC(2026, 3, 1, 12);
const DAY = 24 * 60 * 60 * 1000;

async function authHeader() {
  const token = await createSecureToken({ userId: TEST_USER_ID, role: 'admin' }, env.APP_SECRET);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const QUESTIONS = [
  {
    id: 'nps',
    type: 'rating',
    scale: 'nps',
    question: 'How likely are you to recommend us?',
    lowerLabel: 'Unlikely',
    upperLabel: 'Very likely',
    branching: [{ when: { type: 'range', min: 0, max: 6 }, next: 'why' }],
  },
  {
    id: 'features',
    type: 'multiple_choice',
    question: 'Which features do you use?',
    options: ['Replay', 'Flags', 'Surveys'],
    hasOther: true,
    branching: [{ when: { type: 'any' }, next: 'end' }],
  },
  { id: 'why', type: 'open', question: 'What should we improve?' },
  { id: 'cta', type: 'link', question: 'Talk to us', url: 'https://example.com/call', optional: true },
];

type SurveyBody = {
  id: string;
  question: string;
  type: string;
  options: string[];
  questions: Array<{ id: string; type: string; question: string; branching: unknown[] }>;
  appearance: { position: string; accent: string; theme: string };
  sampleRate: number;
  responseLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  repeatIntervalDays: number | null;
  hostedEnabled: boolean;
  slug: string | null;
};

async function createSurvey(body: Record<string, unknown>) {
  return fetchWorkerJson<SurveyBody & { message?: string }>(`/api/websites/${TEST_WEBSITE_ID}/surveys`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
}

describe('multi-question surveys', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('creates a survey with questions, branching, targeting and appearance', async () => {
    const { response, body } = await createSurvey({
      name: 'Relationship NPS',
      questions: QUESTIONS,
      sampleRate: 25,
      responseLimit: 500,
      startsAt: BASE,
      endsAt: BASE + 30 * DAY,
      repeatIntervalDays: 90,
      hostedEnabled: true,
      slug: 'Relationship-NPS',
      appearance: { position: 'center', accent: 'blue', submitText: 'Send' },
    });

    expect(response.status).toBe(201);
    expect(body.questions.map((question) => question.id)).toEqual(['nps', 'features', 'why', 'cta']);
    expect(body.questions[0].branching).toEqual([{ when: { type: 'range', min: 0, max: 6 }, next: 'why' }]);
    // Legacy mirror of the first question for older readers and trackers.
    expect(body).toMatchObject({
      question: 'How likely are you to recommend us?',
      type: 'choice',
      options: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      sampleRate: 25,
      responseLimit: 500,
      startsAt: BASE,
      endsAt: BASE + 30 * DAY,
      repeatIntervalDays: 90,
      hostedEnabled: true,
      slug: 'relationship-nps',
      appearance: { position: 'center', accent: 'blue', theme: 'auto' },
    });
  });

  it('rejects branching that points backwards, bad schedules and colors outside the palette', async () => {
    const backwards = await createSurvey({
      name: 'Loop',
      questions: [
        { id: 'a', type: 'open', question: 'A' },
        { id: 'b', type: 'open', question: 'B', branching: [{ when: { type: 'any' }, next: 'a' }] },
      ],
    });
    expect(backwards.response.status).toBe(400);
    expect(backwards.body.message).toContain('forward');

    const schedule = await createSurvey({ name: 'Late', questions: QUESTIONS, startsAt: BASE, endsAt: BASE - 1 });
    expect(schedule.response.status).toBe(400);

    const color = await createSurvey({ name: 'Color', questions: QUESTIONS, appearance: { accent: '#ff00ff' } });
    expect(color.response.status).toBe(400);
  });

  it('keeps hosted slugs unique', async () => {
    const first = await createSurvey({ name: 'Slug one', questions: QUESTIONS, slug: 'shared-slug' });
    expect(first.response.status).toBe(201);
    const second = await createSurvey({ name: 'Slug two', questions: QUESTIONS, slug: 'shared-slug' });
    expect(second.response.status).toBe(409);

    const other = await createSurvey({ name: 'Slug three', questions: QUESTIONS });
    const patch = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/surveys/${other.body.id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ slug: 'shared-slug' }),
    });
    expect(patch.status).toBe(409);
    // Saving a survey with its own slug is fine.
    const same = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/surveys/${first.body.id}`, {
      method: 'PATCH',
      headers: await authHeader(),
      body: JSON.stringify({ slug: 'shared-slug', name: 'Renamed' }),
    });
    expect(same.status).toBe(200);
  });

  it('legacy single-question edits replace only the first question', async () => {
    const created = await createSurvey({ name: 'Legacy edit', questions: QUESTIONS });
    const { response, body } = await fetchWorkerJson<SurveyBody>(
      `/api/websites/${TEST_WEBSITE_ID}/surveys/${created.body.id}`,
      {
        method: 'PATCH',
        headers: await authHeader(),
        body: JSON.stringify({ question: 'Rate checkout', type: 'rating' }),
      },
    );
    expect(response.status).toBe(200);
    expect(body.questions.map((question) => [question.id, question.type])).toEqual([
      ['nps', 'rating'],
      ['features', 'multiple_choice'],
      ['why', 'open'],
      ['cta', 'link'],
    ]);
    expect(body).toMatchObject({ question: 'Rate checkout', type: 'rating', options: [] });
  });

  it('deletes a survey together with its responses', async () => {
    const created = await createSurvey({ name: 'To delete', questions: QUESTIONS });
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, answer, created_at) VALUES ('del-r1', ?1, ?2, '9', ?3)`,
    )
      .bind(created.body.id, TEST_WEBSITE_ID, BASE)
      .run();
    const response = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/surveys/${created.body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(response.status).toBe(200);
    const left = await env.DB.prepare(`SELECT COUNT(*) as n FROM survey_response WHERE survey_id = ?1`)
      .bind(created.body.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe('survey results and export', () => {
  let surveyId = '';

  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
    const created = await createSurvey({ name: 'Results survey', questions: QUESTIONS });
    surveyId = created.body.id;
    const rows: Array<[string, Record<string, unknown> | null, string, number, number]> = [
      ['res-1', { nps: 10, features: ['Replay', 'Flags'] }, '10', 1, BASE],
      ['res-2', { nps: 9, features: ['Flags', 'Custom dashboards'] }, '9', 1, BASE + 1000],
      ['res-3', { nps: 3, why: 'Checkout is slow and confusing' }, '3', 1, BASE + DAY],
      ['res-4', { nps: 7 }, '7', 0, BASE + DAY + 1000],
      // Legacy row written before migration 0049: only the answer column.
      ['res-5', null, '5', 1, BASE + 2 * DAY],
      // Outside the date filter used below.
      ['res-6', { nps: 0, why: '=cmd|calc' }, '0', 1, BASE + 10 * DAY],
    ];
    for (const [id, answers, answer, completed, createdAt] of rows) {
      await env.DB.prepare(
        `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, answer, answers, completed, source, url_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'widget', '/pricing', ?8)`,
      )
        .bind(id, surveyId, TEST_WEBSITE_ID, `session-${id}`, answer, answers ? JSON.stringify(answers) : null, completed, createdAt)
        .run();
    }
  });

  it('aggregates per question with NPS, choices, text sentiment and drop-off', async () => {
    const { response, body } = await fetchWorkerJson<{
      results: {
        total: number;
        completed: number;
        partial: number;
        completionRate: number;
        trend: Array<{ date: string; responses: number; completed: number; partial: number }>;
        questions: Array<Record<string, any>>;
      };
      responses: Array<{ id: string; completed: boolean; answers: Record<string, unknown> }>;
    }>(`/api/websites/${TEST_WEBSITE_ID}/surveys/${surveyId}/responses?startAt=${BASE}&endAt=${BASE + 5 * DAY}`, {
      headers: await authHeader(),
    });

    expect(response.status).toBe(200);
    const results = body.results;
    expect(results).toMatchObject({ total: 5, completed: 4, partial: 1, completionRate: 80 });
    expect(results.trend).toEqual([
      { date: '2026-04-01', responses: 2, completed: 2, partial: 0 },
      { date: '2026-04-02', responses: 2, completed: 1, partial: 1 },
      { date: '2026-04-03', responses: 1, completed: 1, partial: 0 },
    ]);

    const [nps, features, why, cta] = results.questions;
    expect(nps.answered).toBe(5);
    expect(nps.droppedAfter).toBe(1);
    expect(nps.rating.average).toBe(6.8);
    expect(nps.rating.nps).toEqual({ score: 0, promoters: 2, passives: 1, detractors: 2 });
    expect(nps.rating.distribution).toHaveLength(11);
    expect(nps.rating.distribution.find((row: { value: string }) => row.value === '10')).toEqual({
      value: '10',
      count: 1,
      percentage: 20,
    });

    expect(features.answered).toBe(2);
    expect(features.choices).toEqual([
      { value: 'Replay', count: 1, percentage: 50, other: false },
      { value: 'Flags', count: 2, percentage: 100, other: false },
      { value: 'Surveys', count: 0, percentage: 0, other: false },
      { value: 'other', count: 1, percentage: 50, other: true },
    ]);
    expect(features.otherAnswers).toEqual([{ value: 'Custom dashboards', count: 1 }]);

    expect(why.answered).toBe(1);
    expect(why.text.items).toEqual([
      expect.objectContaining({ responseId: 'res-3', value: 'Checkout is slow and confusing', sentiment: 'negative' }),
    ]);
    expect(cta).toMatchObject({ answered: 0, link: { clicks: 0 } });

    const legacy = body.responses.find((row) => row.id === 'res-5');
    expect(legacy).toMatchObject({ completed: true, answers: { nps: 5 } });
    expect(body.responses.find((row) => row.id === 'res-4')).toMatchObject({ completed: false });
  });

  it('filters by completion status', async () => {
    const { body } = await fetchWorkerJson<{ results: { total: number }; responses: Array<{ id: string }> }>(
      `/api/websites/${TEST_WEBSITE_ID}/surveys/${surveyId}/responses?status=partial`,
      { headers: await authHeader() },
    );
    expect(body.results.total).toBe(1);
    expect(body.responses.map((row) => row.id)).toEqual(['res-4']);
  });

  it('exports responses as CSV with one column per question', async () => {
    const response = await fetchWorker(`/api/websites/${TEST_WEBSITE_ID}/surveys/${surveyId}/export`, {
      headers: await authHeader(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    const lines = (await response.text()).trim().split('\r\n');
    expect(lines[0]).toBe(
      'response_id,created_at,status,source,url_path,session_id,distinct_id,Q1: How likely are you to recommend us?,Q2: Which features do you use?,Q3: What should we improve?,Q4: Talk to us',
    );
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(`res-1,${new Date(BASE).toISOString()},complete,widget,/pricing,session-res-1,,10,Replay; Flags,,`);
    expect(lines[4]).toContain(',partial,');
    // Spreadsheet formulas typed by respondents are neutralized.
    expect(lines[6]).toContain(`,'=cmd|calc,`);
  });

  it('feeds every open question of multi-question surveys into the feedback inbox', async () => {
    const { body } = await fetchWorkerJson<{ items: Array<{ id: string; question: string; answer: string }> }>(
      `/api/websites/${TEST_WEBSITE_ID}/surveys/feedback?q=Checkout%20is%20slow`,
      { headers: await authHeader() },
    );
    expect(body.items).toEqual([
      expect.objectContaining({ id: 'res-3', question: 'What should we improve?', answer: 'Checkout is slow and confusing' }),
    ]);
  });
});
