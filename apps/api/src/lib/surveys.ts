import {
  csvRow,
  normalizeResponseAnswers,
  normalizeSurveyQuestions,
  surveyAnswerText,
  surveyRatingRange,
  type SurveyAnswers,
  type SurveyQuestion,
} from '@flareboard/shared';
import type { Env } from '../env';

export type SurveyResponseFilters = {
  answer?: string;
  path?: string;
  search?: string;
  /** Inclusive lower bound on created_at (ms). */
  from?: number;
  /** Exclusive upper bound on created_at (ms). */
  to?: number;
  completion?: 'complete' | 'partial';
};

export type SurveyTrendRow = {
  date: string;
  responses: number;
  sessions: number;
  averageRating: number | null;
};

export type FeedbackInboxFilters = {
  sentiment?: SurveySentiment;
  theme?: SurveyTheme;
  search?: string;
};

type SurveySentiment = 'positive' | 'negative' | 'neutral';

type SurveyTheme =
  | 'price'
  | 'bug'
  | 'confusion'
  | 'feature_request'
  | 'support'
  | 'performance'
  | 'other';

const sentimentKeywords: Record<Exclude<SurveySentiment, 'neutral'>, string[]> = {
  positive: [
    'love',
    'great',
    'good',
    'excellent',
    'easy',
    'fast',
    'helpful',
    'works',
    'perfect',
    '喜欢',
    '很好',
    '不错',
    '满意',
  ],
  negative: [
    'bad',
    'bug',
    'broken',
    'confusing',
    'unclear',
    'expensive',
    'slow',
    'failed',
    'fail',
    'error',
    'issue',
    'problem',
    'hard',
    'blocked',
    'declined',
    '糟糕',
    '错误',
    '慢',
    '贵',
    '失败',
    '问题',
    '不清楚',
  ],
};

const themeKeywords: Array<{ theme: SurveyTheme; keywords: string[] }> = [
  {
    theme: 'price',
    keywords: ['price', 'pricing', 'expensive', 'cost', 'paid', 'billing', '贵', '价格', '费用'],
  },
  {
    theme: 'bug',
    keywords: ['bug', 'broken', 'error', 'failed', 'fail', 'crash', 'declined', '错误', '失败', '崩溃'],
  },
  {
    theme: 'confusion',
    keywords: ['confusing', 'unclear', 'understand', 'where', 'how', 'confused', '不清楚', '困惑'],
  },
  {
    theme: 'support',
    keywords: ['help', 'support', 'contact', 'agent', 'invoice', '客服', '支持', '发票'],
  },
  {
    theme: 'feature_request',
    keywords: ['need', 'want', 'missing', 'add', '希望', '需要', '缺少'],
  },
  {
    theme: 'performance',
    keywords: ['slow', 'lag', 'timeout', '卡', '慢', '超时'],
  },
];

function buildSurveyResponseWhere(filters: SurveyResponseFilters = {}) {
  const clauses = ['website_id = ?1', 'survey_id = ?2'];
  const values: Array<string | number> = [];
  if (filters.from != null) {
    clauses.push(`created_at >= ?${values.length + 3}`);
    values.push(filters.from);
  }
  if (filters.to != null) {
    clauses.push(`created_at < ?${values.length + 3}`);
    values.push(filters.to);
  }
  if (filters.completion) clauses.push(filters.completion === 'complete' ? 'completed = 1' : 'completed = 0');
  if (filters.answer) {
    clauses.push(`answer = ?${values.length + 3}`);
    values.push(filters.answer);
  }
  if (filters.path) {
    clauses.push(`url_path LIKE ?${values.length + 3}`);
    values.push(`%${filters.path}%`);
  }
  if (filters.search) {
    clauses.push(
      `(answer LIKE ?${values.length + 3} OR COALESCE(answers, '') LIKE ?${values.length + 3} OR COALESCE(url_path, '') LIKE ?${values.length + 3})`,
    );
    values.push(`%${filters.search}%`);
  }
  return { where: clauses.join(' AND '), values };
}

function hasKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function classifySentiment(answer: string): SurveySentiment {
  const normalized = answer.toLowerCase();
  const hasNegative = hasKeyword(normalized, sentimentKeywords.negative);
  if (hasNegative) {
    return 'negative';
  }
  if (hasKeyword(normalized, sentimentKeywords.positive)) {
    return 'positive';
  }
  return 'neutral';
}

function classifyTheme(answer: string): SurveyTheme {
  const normalized = answer.toLowerCase();
  return themeKeywords.find((item) => hasKeyword(normalized, item.keywords))?.theme ?? 'other';
}

function percentage(count: number, total: number) {
  return total ? Math.round((count / total) * 10000) / 100 : 0;
}

function parseScore(answer: string) {
  const score = Number(answer);
  return Number.isFinite(score) ? score : null;
}

function npsScore(promoters: number, detractors: number, total: number) {
  return total ? Math.round(((promoters - detractors) / total) * 10000) / 100 : null;
}

export async function getSurveySummary(
  env: Env,
  websiteId: string,
  surveyId: string,
  filters: SurveyResponseFilters = {},
) {
  const { where, values } = buildSurveyResponseWhere(filters);
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) as responses,
       COUNT(DISTINCT session_id) as sessions,
       MAX(created_at) as lastResponseAt
     FROM survey_response
     WHERE ${where}`,
  )
    .bind(websiteId, surveyId, ...values)
    .first<{ responses: number; sessions: number; lastResponseAt: number | null }>();

  const breakdownRows = await env.DB.prepare(
    `SELECT answer,
            COUNT(*) as responses
     FROM survey_response
     WHERE ${where}
     GROUP BY answer
     ORDER BY responses DESC, answer ASC
     LIMIT 20`,
  )
    .bind(websiteId, surveyId, ...values)
    .all<{ answer: string; responses: number }>();

  const insightRows = await env.DB.prepare(
    `SELECT answer
     FROM survey_response
     WHERE ${where}
     LIMIT 5000`,
  )
    .bind(websiteId, surveyId, ...values)
    .all<{ answer: string }>();

  const pageRows = await env.DB.prepare(
    `SELECT COALESCE(url_path, '/') as urlPath,
            COUNT(*) as responses,
            COUNT(DISTINCT session_id) as sessions,
            MAX(created_at) as lastResponseAt
     FROM survey_response
     WHERE ${where}
     GROUP BY COALESCE(url_path, '/')
     ORDER BY responses DESC, lastResponseAt DESC
     LIMIT 20`,
  )
    .bind(websiteId, surveyId, ...values)
    .all<{ urlPath: string; responses: number; sessions: number; lastResponseAt: number | null }>();

  const ratingRow = await env.DB.prepare(
    `SELECT AVG(CAST(answer AS REAL)) as averageRating
     FROM survey_response
     WHERE ${where}
       AND answer IN ('1', '2', '3', '4', '5')`,
  )
    .bind(websiteId, surveyId, ...values)
    .first<{ averageRating: number | null }>();

  const trendRows = await env.DB.prepare(
    `SELECT date(created_at / 1000, 'unixepoch') as date,
            COUNT(*) as responses,
            COUNT(DISTINCT session_id) as sessions,
            AVG(CASE WHEN answer IN ('1', '2', '3', '4', '5') THEN CAST(answer AS REAL) ELSE NULL END) as averageRating,
            SUM(CASE WHEN answer IN ('9', '10') THEN 1 ELSE 0 END) as npsPromoters,
            SUM(CASE WHEN answer IN ('0', '1', '2', '3', '4', '5', '6') THEN 1 ELSE 0 END) as npsDetractors,
            SUM(CASE WHEN answer IN ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10') THEN 1 ELSE 0 END) as npsTotal,
            SUM(CASE WHEN answer IN ('4', '5') THEN 1 ELSE 0 END) as csatSatisfied,
            SUM(CASE WHEN answer IN ('1', '2', '3', '4', '5') THEN 1 ELSE 0 END) as csatTotal
     FROM survey_response
     WHERE ${where}
     GROUP BY date(created_at / 1000, 'unixepoch')
     ORDER BY date ASC
     LIMIT 90`,
  )
    .bind(websiteId, surveyId, ...values)
    .all<{
      date: string;
      responses: number;
      sessions: number;
      averageRating: number | null;
      npsPromoters: number;
      npsDetractors: number;
      npsTotal: number;
      csatSatisfied: number;
      csatTotal: number;
    }>();

  const totalResponses = row?.responses ?? 0;
  const sentimentCounts = new Map<SurveySentiment, number>([
    ['positive', 0],
    ['negative', 0],
    ['neutral', 0],
  ]);
  const themeCounts = new Map<SurveyTheme, number>();
  let npsPromoters = 0;
  let npsPassives = 0;
  let npsDetractors = 0;
  let npsTotal = 0;
  let csatSatisfied = 0;
  let csatTotal = 0;

  for (const item of insightRows.results ?? []) {
    const sentiment = classifySentiment(item.answer);
    const theme = classifyTheme(item.answer);
    sentimentCounts.set(sentiment, (sentimentCounts.get(sentiment) ?? 0) + 1);
    themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    const score = parseScore(item.answer);
    if (score != null && score >= 0 && score <= 10) {
      npsTotal += 1;
      if (score >= 9) npsPromoters += 1;
      else if (score >= 7) npsPassives += 1;
      else npsDetractors += 1;
    }
    if (score != null && score >= 1 && score <= 5) {
      csatTotal += 1;
      if (score >= 4) csatSatisfied += 1;
    }
  }

  return {
    responses: totalResponses,
    sessions: row?.sessions ?? 0,
    lastResponseAt: row?.lastResponseAt ?? null,
    averageRating:
      ratingRow?.averageRating == null
        ? null
        : Math.round(ratingRow.averageRating * 100) / 100,
    breakdown: (breakdownRows.results ?? []).map((item) => ({
      answer: item.answer,
      responses: item.responses,
      percentage: percentage(item.responses, totalResponses),
    })),
    sentiment: Array.from(sentimentCounts.entries())
      .map(([sentiment, responses]) => ({
        sentiment,
        responses,
        percentage: percentage(responses, totalResponses),
      }))
      .filter((item) => item.responses > 0)
      .sort((a, b) => b.responses - a.responses || a.sentiment.localeCompare(b.sentiment)),
    themes: Array.from(themeCounts.entries())
      .map(([theme, responses]) => ({
        theme,
        responses,
        percentage: percentage(responses, totalResponses),
      }))
      .sort((a, b) => b.responses - a.responses || a.theme.localeCompare(b.theme))
      .slice(0, 8),
    pages: (pageRows.results ?? []).map((item) => ({
      urlPath: item.urlPath,
      responses: item.responses,
      sessions: item.sessions,
      lastResponseAt: item.lastResponseAt,
    })),
    trend: (trendRows.results ?? []).map((item) => ({
      date: item.date,
      responses: item.responses,
      sessions: item.sessions,
      averageRating:
        item.averageRating == null ? null : Math.round(item.averageRating * 100) / 100,
      npsScore: npsScore(item.npsPromoters ?? 0, item.npsDetractors ?? 0, item.npsTotal ?? 0),
      csatRate: percentage(item.csatSatisfied ?? 0, item.csatTotal ?? 0),
    })),
    nps:
      npsTotal > 0
        ? {
            score: npsScore(npsPromoters, npsDetractors, npsTotal),
            promoters: npsPromoters,
            passives: npsPassives,
            detractors: npsDetractors,
          }
        : null,
    csat:
      csatTotal > 0
        ? {
            satisfied: csatSatisfied,
            total: csatTotal,
            satisfactionRate: percentage(csatSatisfied, csatTotal),
          }
        : null,
  };
}

type StoredResponseRow = {
  id: string;
  surveyId: string;
  websiteId: string;
  sessionId: string | null;
  visitId: string | null;
  distinctId: string | null;
  answer: string;
  answers: string | null;
  completed: number;
  source: string;
  urlPath: string | null;
  createdAt: number;
};

const RESPONSE_COLUMNS = `response_id as id,
            survey_id as surveyId,
            website_id as websiteId,
            session_id as sessionId,
            visit_id as visitId,
            distinct_id as distinctId,
            answer,
            answers,
            completed,
            source,
            url_path as urlPath,
            created_at as createdAt`;

/**
 * Latest responses, newest first. With `questions`, `answers` is the structured per-question
 * form (legacy rows are mapped to the first question).
 */
export async function getSurveyResponses(
  env: Env,
  websiteId: string,
  surveyId: string,
  limit = 100,
  filters: SurveyResponseFilters = {},
  questions: SurveyQuestion[] = [],
) {
  const { where, values } = buildSurveyResponseWhere(filters);
  const rows = await env.DB.prepare(
    `SELECT ${RESPONSE_COLUMNS}
     FROM survey_response
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ?${values.length + 3}`,
  )
    .bind(websiteId, surveyId, ...values, Math.min(Math.max(limit, 1), 500))
    .all<StoredResponseRow>();

  return (rows.results ?? []).map((row) => ({
    ...row,
    answers: normalizeResponseAnswers(questions, row),
    completed: row.completed !== 0,
  }));
}

/** Rows read for per-question aggregation. Counts above this are exact; distributions are sampled. */
const RESULTS_ROW_CAP = 20_000;
const TEXT_ITEMS_LIMIT = 50;

type CountRow = { value: string; count: number; percentage: number };

export type SurveyQuestionResult = {
  id: string;
  type: SurveyQuestion['type'];
  question: string;
  /** Responses that answered this question. */
  answered: number;
  /** Partial responses whose last answer was this question. */
  droppedAfter: number;
  rating?: {
    min: number;
    max: number;
    average: number | null;
    distribution: CountRow[];
    nps: { score: number | null; promoters: number; passives: number; detractors: number } | null;
  };
  choices?: Array<CountRow & { other: boolean }>;
  otherAnswers?: Array<{ value: string; count: number }>;
  text?: {
    sentiment: Array<{ sentiment: SurveySentiment; responses: number; percentage: number }>;
    themes: Array<{ theme: SurveyTheme; responses: number; percentage: number }>;
    items: Array<{ responseId: string; value: string; sentiment: SurveySentiment; createdAt: number }>;
  };
  link?: { clicks: number };
};

function countRows(counts: Map<string, number>, total: number): CountRow[] {
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count, percentage: percentage(count, total) }));
}

function aggregateQuestion(
  question: SurveyQuestion,
  rows: Array<{ id: string; createdAt: number; answers: SurveyAnswers }>,
): Omit<SurveyQuestionResult, 'droppedAfter'> {
  const values = rows
    .map((row) => ({ row, value: row.answers[question.id] }))
    .filter((item): item is { row: (typeof rows)[number]; value: SurveyAnswers[string] } => item.value !== undefined);
  const answered = values.length;
  const base = { id: question.id, type: question.type, question: question.question, answered };

  if (question.type === 'rating') {
    const { min, max } = surveyRatingRange(question.scale);
    const counts = new Map<string, number>();
    for (let score = min; score <= max; score += 1) counts.set(String(score), 0);
    let sum = 0;
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    for (const { value } of values) {
      const score = Number(value);
      sum += score;
      counts.set(String(score), (counts.get(String(score)) ?? 0) + 1);
      if (score >= 9) promoters += 1;
      else if (score >= 7) passives += 1;
      else detractors += 1;
    }
    return {
      ...base,
      rating: {
        min,
        max,
        average: answered ? Math.round((sum / answered) * 100) / 100 : null,
        distribution: countRows(counts, answered).sort((a, b) => Number(a.value) - Number(b.value)),
        nps:
          question.scale === 'nps'
            ? { score: npsScore(promoters, detractors, answered), promoters, passives, detractors }
            : null,
      },
    };
  }

  if (question.type === 'single_choice' || question.type === 'multiple_choice') {
    const counts = new Map<string, number>(question.options.map((option) => [option, 0]));
    const others = new Map<string, number>();
    let otherTotal = 0;
    for (const { value } of values) {
      const picked = Array.isArray(value) ? value : [String(value)];
      let sawOther = false;
      for (const item of picked) {
        if (counts.has(item)) counts.set(item, (counts.get(item) ?? 0) + 1);
        else {
          others.set(item, (others.get(item) ?? 0) + 1);
          sawOther = true;
        }
      }
      if (sawOther) otherTotal += 1;
    }
    const choices = countRows(counts, answered).map((row) => ({ ...row, other: false }));
    if (question.hasOther || otherTotal > 0) {
      choices.push({ value: 'other', count: otherTotal, percentage: percentage(otherTotal, answered), other: true });
    }
    return {
      ...base,
      choices,
      otherAnswers: Array.from(others.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, 20),
    };
  }

  if (question.type === 'open') {
    const sentimentCounts = new Map<SurveySentiment, number>();
    const themeCounts = new Map<SurveyTheme, number>();
    const items: NonNullable<SurveyQuestionResult['text']>['items'] = [];
    for (const { row, value } of values) {
      const text = surveyAnswerText(value);
      const sentiment = classifySentiment(text);
      const theme = classifyTheme(text);
      sentimentCounts.set(sentiment, (sentimentCounts.get(sentiment) ?? 0) + 1);
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
      if (items.length < TEXT_ITEMS_LIMIT) items.push({ responseId: row.id, value: text, sentiment, createdAt: row.createdAt });
    }
    return {
      ...base,
      text: {
        sentiment: Array.from(sentimentCounts.entries())
          .map(([sentiment, responses]) => ({ sentiment, responses, percentage: percentage(responses, answered) }))
          .sort((a, b) => b.responses - a.responses || a.sentiment.localeCompare(b.sentiment)),
        themes: Array.from(themeCounts.entries())
          .map(([theme, responses]) => ({ theme, responses, percentage: percentage(responses, answered) }))
          .sort((a, b) => b.responses - a.responses || a.theme.localeCompare(b.theme))
          .slice(0, 8),
        items,
      },
    };
  }

  return { ...base, link: { clicks: answered } };
}

/**
 * Per-question results: distributions, NPS, choice counts (multiple choice counts every
 * selected option, so percentages can sum past 100), text answers with sentiment, completion
 * and drop-off, plus responses per day. Totals and the trend are exact SQL counts; per-question
 * figures read the newest RESULTS_ROW_CAP rows (`sampled` says when the cap was hit).
 */
export async function getSurveyResults(
  env: Env,
  websiteId: string,
  surveyId: string,
  questions: SurveyQuestion[],
  filters: SurveyResponseFilters = {},
) {
  const { where, values } = buildSurveyResponseWhere(filters);
  const [totals, trendRows, rows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) as completed
       FROM survey_response WHERE ${where}`,
    )
      .bind(websiteId, surveyId, ...values)
      .first<{ total: number; completed: number }>(),
    env.DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') as date,
              COUNT(*) as responses,
              SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
       FROM survey_response WHERE ${where}
       GROUP BY date(created_at / 1000, 'unixepoch')
       ORDER BY date ASC
       LIMIT 366`,
    )
      .bind(websiteId, surveyId, ...values)
      .all<{ date: string; responses: number; completed: number }>(),
    env.DB.prepare(
      `SELECT response_id as id, answer, answers, completed, created_at as createdAt
       FROM survey_response WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ?${values.length + 3}`,
    )
      .bind(websiteId, surveyId, ...values, RESULTS_ROW_CAP)
      .all<{ id: string; answer: string; answers: string | null; completed: number; createdAt: number }>(),
  ]);

  const parsed = (rows.results ?? []).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    completed: row.completed !== 0,
    answers: normalizeResponseAnswers(questions, row),
  }));

  const droppedAfter = new Map<string, number>();
  const reversed = [...questions].reverse();
  for (const row of parsed) {
    if (row.completed) continue;
    const last = reversed.find((question) => row.answers[question.id] !== undefined);
    if (last) droppedAfter.set(last.id, (droppedAfter.get(last.id) ?? 0) + 1);
  }

  const total = totals?.total ?? 0;
  const completed = totals?.completed ?? 0;
  return {
    total,
    completed,
    partial: total - completed,
    completionRate: percentage(completed, total),
    sampled: total > parsed.length,
    trend: (trendRows.results ?? []).map((row) => ({
      date: row.date,
      responses: row.responses,
      completed: row.completed ?? 0,
      partial: row.responses - (row.completed ?? 0),
    })),
    questions: questions.map(
      (question): SurveyQuestionResult => ({
        ...aggregateQuestion(question, parsed),
        droppedAfter: droppedAfter.get(question.id) ?? 0,
      }),
    ),
  };
}

const CSV_ROW_CAP = 50_000;

/** Responses in the filter as CSV, oldest first, one column per question. */
export async function exportSurveyResponsesCsv(
  env: Env,
  websiteId: string,
  surveyId: string,
  questions: SurveyQuestion[],
  filters: SurveyResponseFilters = {},
) {
  const { where, values } = buildSurveyResponseWhere(filters);
  const rows = await env.DB.prepare(
    `SELECT ${RESPONSE_COLUMNS}
     FROM survey_response
     WHERE ${where}
     ORDER BY created_at ASC
     LIMIT ?${values.length + 3}`,
  )
    .bind(websiteId, surveyId, ...values, CSV_ROW_CAP)
    .all<StoredResponseRow>();

  const header = [
    'response_id',
    'created_at',
    'status',
    'source',
    'url_path',
    'session_id',
    'distinct_id',
    ...questions.map((question, index) => `Q${index + 1}: ${question.question}`),
  ];
  const lines = [csvRow(header)];
  for (const row of rows.results ?? []) {
    const answers = normalizeResponseAnswers(questions, row);
    lines.push(
      csvRow([
        row.id,
        new Date(row.createdAt).toISOString(),
        row.completed !== 0 ? 'complete' : 'partial',
        row.source,
        row.urlPath,
        row.sessionId,
        row.distinctId,
        ...questions.map((question) => {
          const value = answers[question.id];
          return Array.isArray(value) ? value.join('; ') : surveyAnswerText(value);
        }),
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export async function getFeedbackInbox(
  env: Env,
  websiteId: string,
  filters: FeedbackInboxFilters = {},
  limit = 100,
) {
  // Every open-text question of every survey feeds the inbox, not only single-question text surveys.
  const surveyRows = await env.DB.prepare(
    `SELECT survey_id as id, name, question, type, options, questions FROM survey WHERE website_id = ?1`,
  )
    .bind(websiteId)
    .all<{ id: string; name: string; question: string; type: string; options: string | null; questions: string | null }>();
  const surveys = new Map<string, { name: string; questions: SurveyQuestion[]; open: SurveyQuestion[] }>();
  for (const row of surveyRows.results ?? []) {
    const questions = normalizeSurveyQuestions(row);
    const open = questions.filter((question) => question.type === 'open');
    if (open.length) surveys.set(row.id, { name: row.name, questions, open });
  }

  const search = filters.search?.trim() ?? '';
  const searchPattern = search ? `%${search}%` : null;
  const fetchLimit = filters.sentiment || filters.theme || search ? 500 : Math.min(Math.max(limit, 1), 500);
  const rows = surveys.size
    ? await env.DB.prepare(
        `SELECT response_id as id,
                survey_id as surveyId,
                session_id as sessionId,
                visit_id as visitId,
                answer,
                answers,
                url_path as urlPath,
                created_at as createdAt
         FROM survey_response
         WHERE website_id = ?1
           AND survey_id IN (SELECT value FROM json_each(?2))
           AND (?3 IS NULL OR answer LIKE ?3 OR COALESCE(answers, '') LIKE ?3 OR COALESCE(url_path, '') LIKE ?3)
         ORDER BY created_at DESC
         LIMIT ?4`,
      )
        .bind(websiteId, JSON.stringify([...surveys.keys()]), searchPattern, fetchLimit)
        .all<{
          id: string;
          surveyId: string;
          sessionId: string | null;
          visitId: string | null;
          answer: string;
          answers: string | null;
          urlPath: string | null;
          createdAt: number;
        }>()
    : null;

  const needle = search.toLowerCase();
  const mapped = (rows?.results ?? []).flatMap((row) => {
    const survey = surveys.get(row.surveyId);
    if (!survey) return [];
    const answers = normalizeResponseAnswers(survey.questions, row);
    return survey.open.flatMap((question) => {
      const answer = surveyAnswerText(answers[question.id]);
      if (!answer) return [];
      if (needle && !answer.toLowerCase().includes(needle) && !(row.urlPath ?? '').toLowerCase().includes(needle)) {
        return [];
      }
      return [
        {
          // One item per open answer. Surveys with a single open question keep the response id.
          id: survey.open.length > 1 ? `${row.id}:${question.id}` : row.id,
          responseId: row.id,
          surveyId: row.surveyId,
          surveyName: survey.name,
          questionId: question.id,
          question: question.question,
          sessionId: row.sessionId,
          visitId: row.visitId,
          answer,
          urlPath: row.urlPath,
          createdAt: row.createdAt,
          sentiment: classifySentiment(answer),
          theme: classifyTheme(answer),
        },
      ];
    });
  });

  const filtered = mapped
    .filter((row) => !filters.sentiment || row.sentiment === filters.sentiment)
    .filter((row) => !filters.theme || row.theme === filters.theme);

  // Summary must describe the filtered view, so counts are computed after filters.
  const sentimentCounts = new Map<SurveySentiment, number>();
  const themeCounts = new Map<SurveyTheme, number>();
  for (const item of filtered) {
    sentimentCounts.set(item.sentiment, (sentimentCounts.get(item.sentiment) ?? 0) + 1);
    themeCounts.set(item.theme, (themeCounts.get(item.theme) ?? 0) + 1);
  }
  const summaryTotal = filtered.length;

  const items = filtered.slice(0, Math.min(Math.max(limit, 1), 500));

  return {
    summary: {
      total: summaryTotal,
      sentiments: Array.from(sentimentCounts.entries())
        .map(([sentiment, responses]) => ({
          sentiment,
          responses,
          percentage: percentage(responses, summaryTotal),
        }))
        .sort((a, b) => b.responses - a.responses || a.sentiment.localeCompare(b.sentiment)),
      themes: Array.from(themeCounts.entries())
        .map(([theme, responses]) => ({
          theme,
          responses,
          percentage: percentage(responses, summaryTotal),
        }))
        .sort((a, b) => b.responses - a.responses || a.theme.localeCompare(b.theme)),
    },
    items,
  };
}
