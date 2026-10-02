import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart } from 'recharts';
import { ChevronDown, Download, MessageSquareText } from 'lucide-react';
import { surveyAnswerText } from '@flareboard/shared/survey-flow';
import { AnalyticsChart } from '../AnalyticsChart';
import { BreakdownList } from '../BreakdownList';
import { ChartLegend } from '../ChartLegend';
import { DataViewState } from '../DataViewState';
import { EmptyState } from '../EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../KpiStrip';
import { ResourceSearchField } from '../master-detail';
import { formatShare, tf, utcDay } from '../product/format';
import { ProductNote, ProductSection } from '../product/ProductSection';
import { ProductTabs } from '../product/ProductTabs';
import { RelativeTime, ShortDate } from '../product/ProductTime';
import { SessionLink } from '../product/SessionLink';
import { SplitBar } from '../product/SplitBar';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  api,
  authenticatedFetch,
  type Survey,
  type SurveyQuestionResult,
  type SurveyResponsesResponse,
  type SurveyResults as SurveyResultsData,
} from '../../lib/api';
import { BAR_MARK, STACK_MARK } from '../../lib/chartMarks';
import { formatNumber, formatPercent, formatShortDate } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useChartColors } from '../../lib/useChartColors';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { questionTypeLabel } from './SurveyBuilderDialog';

type RangeKey = 'all' | '7d' | '30d' | '90d';
type StatusKey = '' | 'complete' | 'partial';
type ResultsTab = 'results' | 'responses' | 'setup';

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };
const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'surveyRangeAll',
  '7d': 'datePreset7d',
  '30d': 'datePreset30d',
  '90d': 'datePreset90d',
};

function rangeParams(range: RangeKey) {
  if (range === 'all') return null;
  const endAt = Date.now();
  return { startAt: endAt - RANGE_DAYS[range] * 24 * 60 * 60 * 1000, endAt };
}

type Sentiment = 'positive' | 'negative' | 'neutral';

function sentimentLabel(sentiment: Sentiment) {
  return t(`sentiment_${sentiment}`);
}

/** Ordered shares (sentiment, NPS groups) use the diverging pair: warm negative, gray, cool positive. */
const SENTIMENT_COLOR: Record<Sentiment, string> = {
  negative: 'var(--product-negative)',
  neutral: 'var(--product-neutral)',
  positive: 'var(--product-positive)',
};

/** The survey's headline score: NPS, CSAT (share of 4–5 on a 5-point scale) or an average rating. */
export function surveyScore(results: SurveyResultsData | undefined) {
  const rating = results?.questions.find((question) => question.rating)?.rating;
  if (!rating) return null;
  if (rating.nps) {
    const total = rating.nps.promoters + rating.nps.passives + rating.nps.detractors;
    return {
      kind: 'nps' as const,
      value: rating.nps.score,
      hint:
        total > 0
          ? tf('productSurveyNpsHint', {
              promoters: formatShare((rating.nps.promoters / total) * 100),
              detractors: formatShare((rating.nps.detractors / total) * 100),
            })
          : undefined,
    };
  }
  if (rating.min === 1 && rating.max === 5) {
    const answered = rating.distribution.reduce((sum, row) => sum + row.count, 0);
    const satisfied = rating.distribution
      .filter((row) => Number(row.value) >= 4)
      .reduce((sum, row) => sum + row.count, 0);
    return {
      kind: 'csat' as const,
      value: answered ? (satisfied / answered) * 100 : null,
      hint: t('productSurveyCsatHint'),
    };
  }
  return {
    kind: 'average' as const,
    value: rating.average,
    hint: tf('productSurveyOutOf', { max: rating.max }),
  };
}

const ANSWER_PREVIEW = 5;
const PAGE_PREVIEW = 8;

function ShowAllButton({ expanded, total, onToggle }: { expanded: boolean; total: number; onToggle: () => void }) {
  return (
    <button type="button" className="card-footer-link product-show-all" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? t('productShowFewer') : tf('productShowAll', { count: formatNumber(total) })}
      <ChevronDown className={expanded ? 'is-flipped' : undefined} strokeWidth={2} aria-hidden />
    </button>
  );
}

function QuestionResult({ result, index }: { result: SurveyQuestionResult; index: number }) {
  const chartColors = useChartColors();
  const [showAll, setShowAll] = useState(false);
  const meta = [
    `${t('surveyQuestionNumber').replace('{n}', String(index + 1))} · ${questionTypeLabel(result.type)}`,
    tf('productSurveyAnswered', { count: formatNumber(result.answered) }),
    result.droppedAfter ? t('surveyDroppedAfter').replace('{count}', formatNumber(result.droppedAfter)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let headline: ReactNode = null;
  if (result.rating?.nps && result.rating.nps.score != null) {
    headline = (
      <span className="product-score">
        <span>{t('surveyNpsScore')}</span>
        <strong>{formatNumber(result.rating.nps.score, { maximumFractionDigits: 1 })}</strong>
      </span>
    );
  } else if (result.rating && result.rating.average != null) {
    headline = (
      <span className="product-score">
        <span>{t('surveyAverageRating')}</span>
        <strong>{formatNumber(result.rating.average, { maximumFractionDigits: 2 })}</strong>
        <span>/ {result.rating.max}</span>
      </span>
    );
  } else if (result.link) {
    headline = (
      <span className="product-score">
        <strong>{formatNumber(result.link.clicks)}</strong>
        <span>{t('productSurveyClicks')}</span>
      </span>
    );
  }

  const choiceMax = Math.max(1, ...(result.choices ?? []).map((row) => row.count));

  return (
    <ProductSection title={result.question} description={meta} actions={headline} aria-label={result.question}>
      {result.rating ? (
        <>
          {result.rating.nps ? (
            <SplitBar
              ariaLabel={t('surveyNpsScore')}
              segments={[
                {
                  key: 'detractors',
                  label: t('surveyNpsDetractors'),
                  value: result.rating.nps.detractors,
                  color: 'var(--product-negative)',
                  detail: formatNumber(result.rating.nps.detractors),
                },
                {
                  key: 'passives',
                  label: t('surveyNpsPassives'),
                  value: result.rating.nps.passives,
                  color: 'var(--product-neutral)',
                  detail: formatNumber(result.rating.nps.passives),
                },
                {
                  key: 'promoters',
                  label: t('surveyNpsPromoters'),
                  value: result.rating.nps.promoters,
                  color: 'var(--product-positive)',
                  detail: formatNumber(result.rating.nps.promoters),
                },
              ]}
            />
          ) : null}
          <div className="product-chart" aria-label={t('surveyDistribution')}>
            <AnalyticsChart
              Chart={BarChart}
              data={result.rating.distribution.map((row) => ({ x: row.value, count: row.count, share: row.percentage }))}
              responsive={{ height: 168 }}
              xAxis={{ dataKey: 'x', interval: 0, minTickGap: 0 }}
              tooltip={{
                formatter: (value: unknown, _name: unknown, entry: { payload?: Record<string, unknown> }) => [
                  `${formatNumber(Number(value))} · ${formatShare(Number(entry.payload?.share ?? 0))}`,
                  t('surveyResponsesLabel'),
                ],
              }}
            >
              <Bar dataKey="count" name={t('surveyResponsesLabel')} fill={chartColors.accent} {...BAR_MARK} />
            </AnalyticsChart>
          </div>
        </>
      ) : null}

      {result.choices ? (
        <>
          <BreakdownList
            labelHeader={t('answer')}
            columns={[{ label: t('surveyResponsesLabel') }, { label: t('productShare') }]}
            items={result.choices.map((row) => ({
              id: `${row.other}-${row.value}`,
              label: row.other ? t('surveyWidgetOther') : row.value,
              title: row.value,
              share: row.count / choiceMax,
              values: [formatNumber(row.count), formatShare(row.percentage)],
            }))}
          />
          {result.type === 'multiple_choice' ? <ProductNote>{t('surveyMultipleChoiceHint')}</ProductNote> : null}
          {result.otherAnswers?.length ? (
            <details className="product-disclosure">
              <summary>{t('surveyOtherAnswers').replace('{count}', String(result.otherAnswers.length))}</summary>
              <ul className="product-answer-list">
                {result.otherAnswers.map((row) => (
                  <li key={row.value}>
                    <p>{row.value}</p>
                    <span className="product-answer-meta">× {formatNumber(row.count)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {result.text ? (
        <>
          {result.text.sentiment.length ? (
            <SplitBar
              ariaLabel={t('surveySentimentBreakdown')}
              segments={(['negative', 'neutral', 'positive'] as const).map((sentiment) => {
                const row = result.text!.sentiment.find((item) => item.sentiment === sentiment);
                return {
                  key: sentiment,
                  label: sentimentLabel(sentiment),
                  value: row?.responses ?? 0,
                  color: SENTIMENT_COLOR[sentiment],
                  detail: formatNumber(row?.responses ?? 0),
                };
              })}
            />
          ) : null}
          {result.text.items.length ? (
            <ul className="product-answer-list">
              {(showAll ? result.text.items : result.text.items.slice(0, ANSWER_PREVIEW)).map((item) => (
                <li key={item.responseId}>
                  <p>{item.value}</p>
                  <span className="product-answer-meta">
                    <span
                      className="product-split-key"
                      style={{ '--split-color': SENTIMENT_COLOR[item.sentiment] } as React.CSSProperties}
                      aria-hidden
                    />
                    {sentimentLabel(item.sentiment)}
                    {' · '}
                    <RelativeTime value={item.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="product-muted-line">{t('surveyNoResponses')}</p>
          )}
          {result.text.items.length > ANSWER_PREVIEW ? (
            <ShowAllButton expanded={showAll} total={result.text.items.length} onToggle={() => setShowAll((value) => !value)} />
          ) : null}
        </>
      ) : null}

      {result.link ? <p className="product-muted-line">{t('surveyLinkClicks').replace('{count}', formatNumber(result.link.clicks))}</p> : null}
    </ProductSection>
  );
}

function ResponsesChart({ results }: { results: SurveyResultsData }) {
  const chartColors = useChartColors();
  const hasPartial = results.trend.some((row) => row.partial > 0);
  const data = results.trend.map((row) => ({
    x: formatShortDate(utcDay(row.date), { timeZone: 'UTC' }),
    completed: row.completed,
    partial: row.partial,
  }));
  return (
    <ProductSection
      title={t('productSurveyPerDay')}
      description={t('productDaysUtc')}
      actions={
        hasPartial ? (
          <ChartLegend
            items={[
              { label: t('surveyStatusComplete'), color: 'var(--chart-1)', shape: 'box' },
              { label: t('surveyStatusPartial'), color: 'var(--chart-2)', shape: 'box' },
            ]}
          />
        ) : null
      }
    >
      <div className="product-chart">
        <AnalyticsChart
          Chart={BarChart}
          data={data}
          responsive={{ height: 200 }}
          xAxis={{ dataKey: 'x', interval: 'preserveStartEnd', minTickGap: 32 }}
        >
          {hasPartial ? (
            <>
              <Bar
                dataKey="completed"
                name={t('surveyStatusComplete')}
                stackId="responses"
                fill={chartColors.palette[0] || chartColors.accent}
                stroke={chartColors.panel}
                strokeWidth={1}
                {...STACK_MARK}
              />
              <Bar
                dataKey="partial"
                name={t('surveyStatusPartial')}
                stackId="responses"
                fill={chartColors.palette[1] || chartColors.accent}
                stroke={chartColors.panel}
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
                {...STACK_MARK}
              />
            </>
          ) : (
            <Bar dataKey="completed" name={t('surveyResponsesLabel')} fill={chartColors.accent} {...BAR_MARK} />
          )}
        </AnalyticsChart>
      </div>
    </ProductSection>
  );
}

/**
 * The detail of a survey: one filter row (range, status, search, page, export), the headline
 * numbers, then Results (trend, per-question breakdowns, pages), Responses and Setup tabs.
 */
export function SurveyResults({ websiteId, survey, setup }: { websiteId: string; survey: Survey; setup: ReactNode }) {
  const [range, setRange] = useState<RangeKey>('all');
  const [status, setStatus] = useState<StatusKey>('');
  const [search, setSearch] = useState('');
  const [path, setPath] = useState('');
  const [tab, setTab] = useState<ResultsTab>('results');
  const [allPages, setAllPages] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedPath = useDebouncedValue(path, 300);

  useEffect(() => {
    setRange('all');
    setStatus('');
    setSearch('');
    setPath('');
    setTab('results');
  }, [survey.id]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    const bounds = rangeParams(range);
    if (bounds) {
      params.set('startAt', String(bounds.startAt));
      params.set('endAt', String(bounds.endAt));
    }
    if (status) params.set('status', status);
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
    if (debouncedPath.trim()) params.set('path', debouncedPath.trim());
    return params.toString();
    // `range` recomputes bounds at query time: the key below keeps it stable per selection.
  }, [range, status, debouncedSearch, debouncedPath]);

  const responsesQuery = useQuery({
    queryKey: ['survey-responses', websiteId, survey.id, range, status, debouncedSearch, debouncedPath],
    queryFn: () =>
      api<SurveyResponsesResponse>(`/api/websites/${websiteId}/surveys/${survey.id}/responses${query ? `?${query}` : ''}`),
    // Filter changes keep the previous numbers on screen instead of flashing skeletons.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === survey.id ? keepPreviousData(previous) : undefined,
  });

  const data = responsesQuery.data;
  const results = data?.results;
  const questions = data?.survey.questions ?? survey.questions;
  const lastResponseAt = data?.summary.lastResponseAt ?? null;
  const score = surveyScore(results);
  const filtersActive = range !== 'all' || Boolean(status || search.trim() || path.trim());

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await authenticatedFetch(`/api/websites/${websiteId}/surveys/${survey.id}/export${query ? `?${query}` : ''}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || t('exportFailed'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `survey-${survey.slug || survey.id}-responses.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t('exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const scoreLabel =
    score?.kind === 'nps' ? t('surveyNpsScore') : score?.kind === 'csat' ? t('productSurveyCsat') : t('surveyAverageRating');
  const scoreValue =
    score?.value == null
      ? '–'
      : score.kind === 'csat'
        ? formatShare(score.value)
        : formatNumber(score.value, { maximumFractionDigits: score.kind === 'nps' ? 1 : 2 });

  const resultsTab = results ? (
    <>
      {results.trend.length > 1 ? <ResponsesChart results={results} /> : null}
      {results.total === 0 ? (
        <ProductSection>
          <EmptyState
            icon={<MessageSquareText strokeWidth={2} />}
            title={filtersActive ? t('productSurveyNoMatches') : t('surveyNoResponses')}
            description={filtersActive ? t('productSurveyNoMatchesHint') : t('productSurveyNoResponsesHint')}
          />
        </ProductSection>
      ) : (
        results.questions.map((result, index) => <QuestionResult key={result.id} result={result} index={index} />)
      )}
      {data?.summary.pages?.length ? (
        <ProductSection title={t('surveyPageBreakdown')} description={t('surveyPageBreakdownLead')}>
          <BreakdownList
            labelHeader={t('page')}
            columns={[{ label: t('surveyResponsesLabel') }, { label: t('surveyLastResponse') }]}
            items={(() => {
              const max = Math.max(1, ...data.summary.pages.map((item) => item.responses));
              const pages = allPages ? data.summary.pages : data.summary.pages.slice(0, PAGE_PREVIEW);
              return pages.map((item) => ({
                id: item.urlPath,
                label: item.urlPath,
                title: item.urlPath,
                mono: true,
                share: item.responses / max,
                values: [formatNumber(item.responses), <RelativeTime key="last" value={item.lastResponseAt} />],
              }));
            })()}
          />
          {data.summary.pages.length > PAGE_PREVIEW ? (
            <ShowAllButton
              expanded={allPages}
              total={data.summary.pages.length}
              onToggle={() => setAllPages((value) => !value)}
            />
          ) : null}
        </ProductSection>
      ) : null}
    </>
  ) : null;

  const responsesTab = (
    <ProductSection title={t('surveyLatestResponses')} description={t('surveyLatestResponsesLead')}>
      {data?.responses.length ? (
        <div className="table-scroll">
          <table className="data-table product-table product-responses-table">
            <thead>
              <tr>
                <th>{t('productTime')}</th>
                <th>{t('status')}</th>
                <th>{t('productSurveyAnswers')}</th>
                <th>{t('page')}</th>
                <th>{t('session')}</th>
              </tr>
            </thead>
            <tbody>
              {data.responses.map((response) => (
                <tr key={response.id}>
                  <td className="text-muted product-nowrap">
                    <ShortDate value={response.createdAt} withTime />
                  </td>
                  <td>
                    <span className="product-badges product-badges--nowrap">
                      <StatusBadge tone={response.completed ? 'success' : 'warning'}>
                        {response.completed ? t('surveyStatusComplete') : t('surveyStatusPartial')}
                      </StatusBadge>
                      {response.source === 'hosted' ? (
                        <StatusBadge dot={false}>{t('surveySourceHosted')}</StatusBadge>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    <dl className="product-qa">
                      {questions
                        .filter((question) => response.answers[question.id] !== undefined)
                        .map((question) => (
                          <div key={question.id}>
                            <dt>{question.question}</dt>
                            <dd>{surveyAnswerText(response.answers[question.id])}</dd>
                          </div>
                        ))}
                    </dl>
                  </td>
                  <td className="mono product-path-cell">{response.urlPath ?? '–'}</td>
                  <td>
                    <SessionLink websiteId={websiteId} sessionId={response.sessionId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<MessageSquareText strokeWidth={2} />}
          title={filtersActive ? t('productSurveyNoMatches') : t('surveyNoResponses')}
          description={filtersActive ? t('productSurveyNoMatchesHint') : t('productSurveyNoResponsesHint')}
        />
      )}
    </ProductSection>
  );

  return (
    <>
      <div className="product-toolbar" role="group" aria-label={t('productSurveyFilters')}>
        <select
          className="select product-toolbar-select"
          aria-label={t('dateRange')}
          value={range}
          onChange={(event) => setRange(event.target.value as RangeKey)}
        >
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
            <option key={key} value={key}>
              {t(RANGE_LABELS[key])}
            </option>
          ))}
        </select>
        <select
          className="select product-toolbar-select"
          aria-label={t('status')}
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusKey)}
        >
          <option value="">{t('productSurveyAllResponses')}</option>
          <option value="complete">{t('surveyStatusComplete')}</option>
          <option value="partial">{t('surveyStatusPartial')}</option>
        </select>
        <ResourceSearchField
          className="product-toolbar-search"
          value={search}
          onChange={setSearch}
          placeholder={t('surveyFilterSearchPlaceholder')}
          aria-label={t('surveyFilterSearch')}
        />
        <Input
          className="product-toolbar-input mono"
          type="search"
          value={path}
          placeholder="/pricing"
          aria-label={t('surveyFilterPath')}
          onChange={(event) => setPath(event.target.value)}
        />
        <span className="toolbar-spacer" />
        <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportCsv()}>
          <Download strokeWidth={2} aria-hidden />
          {exporting ? t('loading') : t('exportCsv')}
        </Button>
      </div>
      {exportError ? <p className="text-danger product-inline-error">{exportError}</p> : null}

      {responsesQuery.isError && !data ? (
        <DataViewState error={responsesQuery.error as Error} onRetry={() => responsesQuery.refetch()}>
          {null}
        </DataViewState>
      ) : (
        <>
          <div className={responsesQuery.isFetching && data ? 'product-kpi-gap is-refreshing' : 'product-kpi-gap'}>
            {results ? (
              <KpiStrip inline columns={score ? 4 : 3}>
                <KpiCell label={t('surveyResponsesLabel')} value={formatNumber(results.total)} hint={filtersActive ? t('productSurveyFiltered') : undefined} />
                <KpiCell
                  label={t('surveyCompletionRate')}
                  value={formatPercent(results.completionRate, { digits: results.completionRate % 1 ? 1 : 0 })}
                  hint={tf('productSurveyPartialCount', { count: formatNumber(results.partial) })}
                />
                {score ? <KpiCell label={scoreLabel} value={scoreValue} hint={score.hint} /> : null}
                <KpiCell
                  label={t('surveyLastResponse')}
                  value={lastResponseAt ? <RelativeTime value={lastResponseAt} /> : '–'}
                />
              </KpiStrip>
            ) : (
              <KpiStripSkeleton cells={4} inline />
            )}
          </div>
          {results?.sampled ? <ProductNote className="product-kpi-note">{t('surveyResultsSampled')}</ProductNote> : null}

          <ProductTabs<ResultsTab>
            label={t('surveys')}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'results', label: t('productSurveyTabResults'), content: resultsTab },
              {
                id: 'responses',
                label: (
                  <>
                    {t('productSurveyTabResponses')}
                    {data ? <span className="product-tab-count">{formatNumber(data.responses.length)}</span> : null}
                  </>
                ),
                content: responsesTab,
              },
              { id: 'setup', label: t('productSurveyTabSetup'), content: setup },
            ]}
          />
        </>
      )}
    </>
  );
}
