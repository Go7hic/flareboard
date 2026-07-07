import type { Env } from '../env';

export type SurveyResponseFilters = {
  answer?: string;
  path?: string;
  search?: string;
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
  const values: string[] = [];
  if (filters.answer) {
    clauses.push(`answer = ?${values.length + 3}`);
    values.push(filters.answer);
  }
  if (filters.path) {
    clauses.push(`url_path LIKE ?${values.length + 3}`);
    values.push(`%${filters.path}%`);
  }
  if (filters.search) {
    clauses.push(`(answer LIKE ?${values.length + 3} OR COALESCE(url_path, '') LIKE ?${values.length + 4})`);
    values.push(`%${filters.search}%`, `%${filters.search}%`);
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

export async function getSurveyResponses(
  env: Env,
  websiteId: string,
  surveyId: string,
  limit = 100,
  filters: SurveyResponseFilters = {},
) {
  const { where, values } = buildSurveyResponseWhere(filters);
  const rows = await env.DB.prepare(
    `SELECT response_id as id,
            survey_id as surveyId,
            website_id as websiteId,
            session_id as sessionId,
            visit_id as visitId,
            answer,
            url_path as urlPath,
            created_at as createdAt
     FROM survey_response
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ?${values.length + 3}`,
  )
    .bind(websiteId, surveyId, ...values, Math.min(Math.max(limit, 1), 500))
    .all<{
      id: string;
      surveyId: string;
      websiteId: string;
      sessionId: string | null;
      visitId: string | null;
      answer: string;
      urlPath: string | null;
      createdAt: number;
    }>();

  return rows.results ?? [];
}

export async function getFeedbackInbox(
  env: Env,
  websiteId: string,
  filters: FeedbackInboxFilters = {},
  limit = 100,
) {
  const searchPattern = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const fetchLimit = filters.sentiment || filters.theme ? 500 : Math.min(Math.max(limit, 1), 500);
  const rows = await env.DB.prepare(
    `SELECT r.response_id as id,
            r.survey_id as surveyId,
            s.name as surveyName,
            s.question as question,
            r.session_id as sessionId,
            r.visit_id as visitId,
            r.answer,
            r.url_path as urlPath,
            r.created_at as createdAt
     FROM survey_response r
     JOIN survey s ON s.survey_id = r.survey_id
     WHERE r.website_id = ?1
       AND s.type = 'text'
       AND (?2 IS NULL OR r.answer LIKE ?2 OR COALESCE(r.url_path, '') LIKE ?2)
     ORDER BY r.created_at DESC
     LIMIT ?3`,
  )
    .bind(websiteId, searchPattern, fetchLimit)
    .all<{
      id: string;
      surveyId: string;
      surveyName: string;
      question: string;
      sessionId: string | null;
      visitId: string | null;
      answer: string;
      urlPath: string | null;
      createdAt: number;
    }>();

  const mapped = (rows.results ?? []).map((row) => {
    const sentiment = classifySentiment(row.answer);
    const theme = classifyTheme(row.answer);
    return { ...row, sentiment, theme };
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
