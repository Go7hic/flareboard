import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { getFeedbackInbox, getSurveyResponses, getSurveySummary } from '../../src/lib/surveys';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const BASE = Date.UTC(2026, 0, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

describe('getSurveySummary', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('counts responses, sessions, and answer breakdown for a survey', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('survey-1', ?1, 'Checkout feedback', 'What stopped you?', 'text', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('response-1', 'survey-1', ?1, 'session-a', 'visit-a', 'Too expensive', '/pricing', ?2),
       ('response-2', 'survey-1', ?1, 'session-b', 'visit-b', 'Need invoice support', '/checkout', ?3),
       ('response-3', 'survey-1', ?1, 'session-c', 'visit-c', 'Too expensive', '/checkout', ?4),
       ('response-4', 'survey-1', ?1, 'session-c', 'visit-c', 'Too expensive', '/checkout', ?5)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000, BASE + 3000, BASE + DAY + 1000)
      .run();

    const summary = await getSurveySummary(env, TEST_WEBSITE_ID, 'survey-1');

    expect(summary).toEqual({
      responses: 4,
      sessions: 3,
      lastResponseAt: BASE + DAY + 1000,
      averageRating: null,
      nps: null,
      csat: null,
      breakdown: [
        { answer: 'Too expensive', responses: 3, percentage: 75 },
        { answer: 'Need invoice support', responses: 1, percentage: 25 },
      ],
      sentiment: [
        { sentiment: 'negative', responses: 3, percentage: 75 },
        { sentiment: 'neutral', responses: 1, percentage: 25 },
      ],
      themes: [
        { theme: 'price', responses: 3, percentage: 75 },
        { theme: 'support', responses: 1, percentage: 25 },
      ],
      pages: [
        {
          urlPath: '/checkout',
          responses: 3,
          sessions: 2,
          lastResponseAt: BASE + DAY + 1000,
        },
        { urlPath: '/pricing', responses: 1, sessions: 1, lastResponseAt: BASE + 1000 },
      ],
      trend: [
        { date: '2026-01-02', responses: 3, sessions: 3, averageRating: null, npsScore: null, csatRate: 0 },
        { date: '2026-01-03', responses: 1, sessions: 1, averageRating: null, npsScore: null, csatRate: 0 },
      ],
    });
  });

  it('calculates average rating for rating surveys', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('survey-rating', ?1, 'Experience rating', 'How was checkout?', 'rating', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('rating-1', 'survey-rating', ?1, 'rating-session-a', 'rating-visit-a', '5', '/checkout', ?2),
       ('rating-2', 'survey-rating', ?1, 'rating-session-b', 'rating-visit-b', '3', '/checkout', ?3)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000)
      .run();

    const summary = await getSurveySummary(env, TEST_WEBSITE_ID, 'survey-rating');

    expect(summary).toMatchObject({
      responses: 2,
      sessions: 2,
      averageRating: 4,
      breakdown: [
        { answer: '3', responses: 1, percentage: 50 },
        { answer: '5', responses: 1, percentage: 50 },
      ],
      sentiment: [{ sentiment: 'neutral', responses: 2, percentage: 100 }],
      themes: [{ theme: 'other', responses: 2, percentage: 100 }],
      pages: [{ urlPath: '/checkout', responses: 2, sessions: 2, lastResponseAt: BASE + 2000 }],
      trend: [{ date: '2026-01-02', responses: 2, sessions: 2, averageRating: 4 }],
    });
  });

  it('calculates NPS score and trend for 0-10 recommendation surveys', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, options, enabled, created_at, updated_at)
       VALUES ('survey-nps', ?1, 'NPS', 'How likely are you to recommend us?', 'choice', ?2, 1, ?3, ?3)`,
    )
      .bind(TEST_WEBSITE_ID, JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']), BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('nps-1', 'survey-nps', ?1, 'nps-session-a', 'nps-visit-a', '10', '/checkout', ?2),
       ('nps-2', 'survey-nps', ?1, 'nps-session-b', 'nps-visit-b', '9', '/checkout', ?3),
       ('nps-3', 'survey-nps', ?1, 'nps-session-c', 'nps-visit-c', '6', '/checkout', ?4),
       ('nps-4', 'survey-nps', ?1, 'nps-session-d', 'nps-visit-d', '8', '/pricing', ?5)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000, BASE + 3000, BASE + DAY + 1000)
      .run();

    const summary = await getSurveySummary(env, TEST_WEBSITE_ID, 'survey-nps');

    expect(summary.nps).toEqual({
      score: 25,
      promoters: 2,
      passives: 1,
      detractors: 1,
    });
    expect(summary.trend).toEqual([
      expect.objectContaining({ date: '2026-01-02', npsScore: 33.33 }),
      expect.objectContaining({ date: '2026-01-03', npsScore: 0 }),
    ]);
  });

  it('calculates CSAT satisfaction rate for rating surveys', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('survey-csat', ?1, 'CSAT', 'How satisfied are you?', 'rating', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('csat-1', 'survey-csat', ?1, 'csat-session-a', 'csat-visit-a', '5', '/checkout', ?2),
       ('csat-2', 'survey-csat', ?1, 'csat-session-b', 'csat-visit-b', '4', '/checkout', ?3),
       ('csat-3', 'survey-csat', ?1, 'csat-session-c', 'csat-visit-c', '2', '/checkout', ?4)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000, BASE + 3000)
      .run();

    const summary = await getSurveySummary(env, TEST_WEBSITE_ID, 'survey-csat');

    expect(summary.csat).toEqual({
      satisfied: 2,
      total: 3,
      satisfactionRate: 66.67,
    });
    expect(summary.trend).toEqual([
      expect.objectContaining({ date: '2026-01-02', csatRate: 66.67 }),
    ]);
  });

  it('filters survey summaries and responses by path and search text', async () => {
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES ('survey-filtered', ?1, 'Pricing feedback', 'What blocked you?', 'text', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, BASE)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('filtered-1', 'survey-filtered', ?1, 'filtered-session-a', 'filtered-visit-a', 'Too expensive', '/pricing', ?2),
       ('filtered-2', 'survey-filtered', ?1, 'filtered-session-b', 'filtered-visit-b', 'Need invoice support', '/checkout', ?3),
       ('filtered-3', 'survey-filtered', ?1, 'filtered-session-c', 'filtered-visit-c', 'Pricing unclear', '/pricing/teams', ?4)`,
    )
      .bind(TEST_WEBSITE_ID, BASE + 1000, BASE + 2000, BASE + 3000)
      .run();

    const summary = await getSurveySummary(env, TEST_WEBSITE_ID, 'survey-filtered', {
      path: '/pricing',
      search: 'unclear',
    });
    const responses = await getSurveyResponses(env, TEST_WEBSITE_ID, 'survey-filtered', 100, {
      path: '/pricing',
      search: 'unclear',
    });

    expect(summary).toMatchObject({
      responses: 1,
      sessions: 1,
      lastResponseAt: BASE + 3000,
      breakdown: [{ answer: 'Pricing unclear', responses: 1, percentage: 100 }],
      sentiment: [{ sentiment: 'negative', responses: 1, percentage: 100 }],
      themes: [{ theme: 'price', responses: 1, percentage: 100 }],
      pages: [
        {
          urlPath: '/pricing/teams',
          responses: 1,
          sessions: 1,
          lastResponseAt: BASE + 3000,
        },
      ],
      trend: [{ date: '2026-01-02', responses: 1, sessions: 1, averageRating: null }],
    });
    expect(responses.map((response) => response.id)).toEqual(['filtered-3']);
  });

  it('returns a feedback inbox across text survey responses', async () => {
    const later = BASE + DAY * 4;
    await env.DB.prepare(
      `INSERT INTO survey (survey_id, website_id, name, question, type, enabled, created_at, updated_at)
       VALUES
       ('survey-inbox-a', ?1, 'Checkout feedback', 'What blocked you?', 'text', 1, ?2, ?2),
       ('survey-inbox-b', ?1, 'Pricing feedback', 'What confused you?', 'text', 1, ?2, ?2)`,
    )
      .bind(TEST_WEBSITE_ID, later)
      .run();
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, session_id, visit_id, answer, url_path, created_at)
       VALUES
       ('inbox-1', 'survey-inbox-a', ?1, 'inbox-session-a', 'inbox-visit-a', 'Inbox checkout is confusing', '/checkout', ?2),
       ('inbox-2', 'survey-inbox-b', ?1, 'inbox-session-b', 'inbox-visit-b', 'Inbox pricing is too expensive', '/pricing', ?3),
       ('inbox-3', 'survey-inbox-a', ?1, 'inbox-session-c', 'inbox-visit-c', 'Inbox love how fast it is', '/checkout', ?4)`,
    )
      .bind(TEST_WEBSITE_ID, later + 1000, later + 2000, later + 3000)
      .run();

    const inbox = await getFeedbackInbox(env, TEST_WEBSITE_ID, { sentiment: 'negative', search: 'Inbox' });

    expect(inbox.summary).toEqual({
      total: 2,
      sentiments: [
        { sentiment: 'negative', responses: 2, percentage: 100 },
      ],
      themes: [
        { theme: 'confusion', responses: 1, percentage: 50 },
        { theme: 'price', responses: 1, percentage: 50 },
      ],
    });
    expect(inbox.items.map((item) => ({
      id: item.id,
      surveyName: item.surveyName,
      sentiment: item.sentiment,
      theme: item.theme,
    }))).toEqual([
      { id: 'inbox-2', surveyName: 'Pricing feedback', sentiment: 'negative', theme: 'price' },
      { id: 'inbox-1', surveyName: 'Checkout feedback', sentiment: 'negative', theme: 'confusion' },
    ]);
  });
});
