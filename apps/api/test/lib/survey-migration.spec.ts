import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { legacySurveyQuestion, normalizeResponseAnswers, normalizeSurveyQuestions } from '@flareboard/shared';
import { applyTestMigrations, seedTestWebsite, TEST_WEBSITE_ID } from '../helpers/migrations';

const migration = Object.values(
  import.meta.glob('../../../../packages/db/migrations/0049_survey_questions.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
)[0];

/** The data steps of migration 0049 (its ALTERs already ran with the other migrations). */
function backfillStatements() {
  const statements = migration
    .split(';')
    .map((part) =>
      part
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((part) => part.startsWith('UPDATE'));
  if (statements.length !== 2) throw new Error('expected two backfill UPDATEs in migration 0049');
  return statements;
}

const NPS_OPTIONS = JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

describe('migration 0049: single-question surveys become question lists', () => {
  beforeAll(async () => {
    await applyTestMigrations(env.DB);
    await seedTestWebsite(env.DB);
  });

  it('backfills questions exactly like legacySurveyQuestion and maps old answers to q1', async () => {
    const legacy = [
      { id: 'mig-text', type: 'text', options: null },
      { id: 'mig-rating', type: 'rating', options: null },
      { id: 'mig-nps', type: 'choice', options: NPS_OPTIONS },
      { id: 'mig-choice', type: 'choice', options: JSON.stringify(['Free', 'Pro']) },
      { id: 'mig-bad', type: 'choice', options: '["Free",' },
    ];
    for (const row of legacy) {
      await env.DB.prepare(
        `INSERT INTO survey (survey_id, website_id, name, question, type, options, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?1, 'Legacy question?', ?3, ?4, 1, 0, 0)`,
      )
        .bind(row.id, TEST_WEBSITE_ID, row.type, row.options)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO survey_response (response_id, survey_id, website_id, answer, created_at)
       VALUES ('mig-r1', 'mig-nps', ?1, '9', 0), ('mig-r2', 'mig-choice', ?1, 'Pro', 0)`,
    )
      .bind(TEST_WEBSITE_ID)
      .run();

    for (const statement of backfillStatements()) await env.DB.prepare(statement).run();

    for (const row of legacy) {
      const stored = await env.DB.prepare(`SELECT question, type, options, questions FROM survey WHERE survey_id = ?1`)
        .bind(row.id)
        .first<{ question: string; type: string; options: string | null; questions: string }>();
      const questions = JSON.parse(stored!.questions);
      expect(questions).toHaveLength(1);
      const expected = legacySurveyQuestion(stored!);
      expect(questions[0]).toMatchObject({ id: 'q1', type: expected.type, question: 'Legacy question?' });
      expect(normalizeSurveyQuestions(stored!)).toEqual([expected]);
    }

    const npsQuestions = normalizeSurveyQuestions({ questions: null, question: 'x', type: 'choice', options: NPS_OPTIONS });
    const response = await env.DB.prepare(`SELECT answer, answers, completed FROM survey_response WHERE response_id = 'mig-r1'`)
      .first<{ answer: string; answers: string; completed: number }>();
    expect(JSON.parse(response!.answers)).toEqual({ q1: '9' });
    expect(response!.completed).toBe(1);
    expect(normalizeResponseAnswers(npsQuestions, response!)).toEqual({ q1: 9 });
  });
});
