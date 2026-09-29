import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, ExternalLink } from 'lucide-react';
import { surveyAnswerText } from '@flareboard/shared/survey-flow';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  api,
  authenticatedFetch,
  type Survey,
  type SurveyQuestionResult,
  type SurveyResponsesResponse,
} from '../../lib/api';
import { formatDateTime, formatNumber, formatPercent } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { questionTypeLabel } from './SurveyBuilderDialog';

type RangeKey = 'all' | '7d' | '30d' | '90d';
type StatusKey = '' | 'complete' | 'partial';

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

function sentimentLabel(sentiment: 'positive' | 'negative' | 'neutral') {
  return t(`sentiment_${sentiment}`);
}

function Bar({ label, count, percentage }: { label: string; count: number; percentage: number }) {
  return (
    <div className="breakdown-row">
      <div className="breakdown-meta">
        <strong>{label}</strong>
        <span className="text-muted">
          {formatNumber(count)} · {formatPercent(percentage, { digits: percentage % 1 ? 1 : 0 })}
        </span>
      </div>
      <div className="breakdown-track" aria-hidden>
        <span style={{ width: `${Math.min(100, percentage)}%` }} />
      </div>
    </div>
  );
}

function QuestionResultCard({ result, index }: { result: SurveyQuestionResult; index: number }) {
  return (
    <article className="survey-result-card">
      <header className="survey-result-head">
        <div>
          <span className="stat-label">
            {t('surveyQuestionNumber').replace('{n}', String(index + 1))} · {questionTypeLabel(result.type)}
          </span>
          <h4 className="survey-result-title">{result.question}</h4>
        </div>
        <div className="survey-result-counts">
          <span>
            <strong className="stat-value">{formatNumber(result.answered)}</strong>{' '}
            <span className="text-muted">{t('surveyAnswered')}</span>
          </span>
          {result.droppedAfter ? (
            <span className="text-muted">{t('surveyDroppedAfter').replace('{count}', formatNumber(result.droppedAfter))}</span>
          ) : null}
        </div>
      </header>

      {result.rating ? (
        <div className="survey-result-body">
          <div className="detail-stats">
            <div>
              <span className="stat-label">{t('surveyAverageRating')}</span>
              <strong className="stat-value">
                {result.rating.average == null ? '-' : formatNumber(result.rating.average, { maximumFractionDigits: 2 })}
              </strong>
            </div>
            {result.rating.nps ? (
              <>
                <div>
                  <span className="stat-label">{t('surveyNpsScore')}</span>
                  <strong className="stat-value">
                    {result.rating.nps.score == null ? '-' : formatNumber(result.rating.nps.score, { maximumFractionDigits: 1 })}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">{t('surveyNpsPromoters')}</span>
                  <strong className="stat-value">{formatNumber(result.rating.nps.promoters)}</strong>
                </div>
                <div>
                  <span className="stat-label">{t('surveyNpsPassives')}</span>
                  <strong className="stat-value">{formatNumber(result.rating.nps.passives)}</strong>
                </div>
                <div>
                  <span className="stat-label">{t('surveyNpsDetractors')}</span>
                  <strong className="stat-value">{formatNumber(result.rating.nps.detractors)}</strong>
                </div>
              </>
            ) : null}
          </div>
          <div className="survey-rating-distribution" role="list" aria-label={t('surveyDistribution')}>
            {result.rating.distribution.map((row) => (
              <div key={row.value} className="survey-rating-bar" role="listitem" title={`${row.value}: ${row.count}`}>
                <div className="survey-rating-bar-track">
                  <span style={{ height: `${Math.min(100, row.percentage)}%` }} />
                </div>
                <span className="survey-rating-bar-label">{row.value}</span>
                <span className="text-muted survey-rating-bar-count">{formatNumber(row.count)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.choices ? (
        <div className="survey-result-body">
          <div className="breakdown-list">
            {result.choices.map((row) => (
              <Bar key={`${row.other}-${row.value}`} label={row.other ? t('surveyWidgetOther') : row.value} count={row.count} percentage={row.percentage} />
            ))}
          </div>
          {result.type === 'multiple_choice' ? <p className="text-muted">{t('surveyMultipleChoiceHint')}</p> : null}
          {result.otherAnswers?.length ? (
            <details className="survey-result-other">
              <summary className="text-muted">{t('surveyOtherAnswers').replace('{count}', String(result.otherAnswers.length))}</summary>
              <ul>
                {result.otherAnswers.map((row) => (
                  <li key={row.value}>
                    {row.value} <span className="text-muted">× {formatNumber(row.count)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {result.text ? (
        <div className="survey-result-body">
          {result.text.sentiment.length ? (
            <div className="breakdown-list">
              {result.text.sentiment.map((row) => (
                <Bar key={row.sentiment} label={sentimentLabel(row.sentiment)} count={row.responses} percentage={row.percentage} />
              ))}
            </div>
          ) : null}
          {result.text.items.length ? (
            <ul className="survey-text-answers">
              {result.text.items.map((item) => (
                <li key={item.responseId}>
                  <p>{item.value}</p>
                  <span className="text-muted">
                    <span className={`survey-sentiment survey-sentiment--${item.sentiment}`}>{sentimentLabel(item.sentiment)}</span>
                    {' · '}
                    {formatDateTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t('surveyNoResponses')}</p>
          )}
        </div>
      ) : null}

      {result.link ? (
        <p className="text-muted survey-result-body">
          {t('surveyLinkClicks').replace('{count}', formatNumber(result.link.clicks))}
        </p>
      ) : null}
    </article>
  );
}

export function SurveyResults({ websiteId, survey }: { websiteId: string; survey: Survey }) {
  const [range, setRange] = useState<RangeKey>('all');
  const [status, setStatus] = useState<StatusKey>('');
  const [search, setSearch] = useState('');
  const [path, setPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedPath = useDebouncedValue(path, 300);

  useEffect(() => {
    setRange('all');
    setStatus('');
    setSearch('');
    setPath('');
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
  });

  const data = responsesQuery.data;
  const results = data?.results;
  const questions = data?.survey.questions ?? survey.questions;
  const lastResponseAt = data?.summary.lastResponseAt ?? null;

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

  const maxTrend = Math.max(1, ...(results?.trend ?? []).map((row) => row.responses));

  return (
    <div className="survey-results">
      <div className="survey-response-filters survey-results-filters">
        <div className="field">
          <Label htmlFor="survey-results-range">{t('dateRange')}</Label>
          <select
            id="survey-results-range"
            className="select"
            value={range}
            onChange={(event) => setRange(event.target.value as RangeKey)}
          >
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <option key={key} value={key}>
                {t(RANGE_LABELS[key])}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <Label htmlFor="survey-results-status">{t('status')}</Label>
          <select
            id="survey-results-status"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusKey)}
          >
            <option value="">{t('all')}</option>
            <option value="complete">{t('surveyStatusComplete')}</option>
            <option value="partial">{t('surveyStatusPartial')}</option>
          </select>
        </div>
        <div className="field">
          <Label htmlFor="survey-results-search">{t('surveyFilterSearch')}</Label>
          <Input
            id="survey-results-search"
            type="search"
            value={search}
            placeholder={t('surveyFilterSearchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="field">
          <Label htmlFor="survey-results-path">{t('surveyFilterPath')}</Label>
          <Input
            id="survey-results-path"
            type="search"
            value={path}
            placeholder="/pricing"
            onChange={(event) => setPath(event.target.value)}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportCsv()}>
          <Download size={14} strokeWidth={2} aria-hidden />
          {exporting ? t('loading') : t('exportCsv')}
        </Button>
      </div>
      {exportError ? <p className="text-danger">{exportError}</p> : null}

      {responsesQuery.isLoading ? <div className="skeleton skeleton-block" aria-busy /> : null}
      {responsesQuery.error ? <p className="text-danger">{(responsesQuery.error as Error).message}</p> : null}

      {results ? (
        <>
          <div className="detail-stats">
            <div>
              <span className="stat-label">{t('surveyResponsesLabel')}</span>
              <strong className="stat-value">{formatNumber(results.total)}</strong>
            </div>
            <div>
              <span className="stat-label">{t('surveyStatusComplete')}</span>
              <strong className="stat-value">{formatNumber(results.completed)}</strong>
            </div>
            <div>
              <span className="stat-label">{t('surveyStatusPartial')}</span>
              <strong className="stat-value">{formatNumber(results.partial)}</strong>
            </div>
            <div>
              <span className="stat-label">{t('surveyCompletionRate')}</span>
              <strong className="stat-value">{formatPercent(results.completionRate, { digits: 1 })}</strong>
            </div>
            <div>
              <span className="stat-label">{t('surveyLastResponse')}</span>
              <strong className="stat-value">{formatDateTime(lastResponseAt)}</strong>
            </div>
          </div>
          {results.sampled ? <p className="text-muted">{t('surveyResultsSampled')}</p> : null}

          {results.trend.length ? (
            <div className="detail-section">
              <div className="panel-header compact-panel-header">
                <div>
                  <h3 className="section-title experiment-title">{t('surveyTrend')}</h3>
                  <p className="text-muted">{t('surveyTrendLeadMulti')}</p>
                </div>
              </div>
              <div className="survey-trend" role="list">
                {results.trend.map((row) => (
                  <div
                    key={row.date}
                    className="survey-trend-bar"
                    role="listitem"
                    title={`${row.date}: ${row.completed} ${t('surveyStatusComplete')}, ${row.partial} ${t('surveyStatusPartial')}`}
                  >
                    <div className="survey-trend-track">
                      <span className="survey-trend-partial" style={{ height: `${(row.partial / maxTrend) * 100}%` }} />
                      <span className="survey-trend-complete" style={{ height: `${(row.completed / maxTrend) * 100}%` }} />
                    </div>
                    <span className="survey-trend-label text-muted">{row.date.slice(5)}</span>
                  </div>
                ))}
              </div>
              <div className="survey-trend-legend text-muted">
                <span>
                  <i className="survey-legend-swatch survey-trend-complete" aria-hidden /> {t('surveyStatusComplete')}
                </span>
                <span>
                  <i className="survey-legend-swatch survey-trend-partial" aria-hidden /> {t('surveyStatusPartial')}
                </span>
              </div>
            </div>
          ) : null}

          <div className="survey-result-list">
            {results.questions.map((result, index) => (
              <QuestionResultCard key={result.id} result={result} index={index} />
            ))}
          </div>

          {data?.summary.pages?.length ? (
            <div className="detail-section">
              <div className="panel-header compact-panel-header">
                <div>
                  <h3 className="section-title experiment-title">{t('surveyPageBreakdown')}</h3>
                  <p className="text-muted">{t('surveyPageBreakdownLead')}</p>
                </div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('page')}</th>
                      <th>{t('surveyResponses')}</th>
                      <th>{t('surveyLastResponse')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.pages.map((item) => (
                      <tr key={item.urlPath}>
                        <td>{item.urlPath}</td>
                        <td className="num">{formatNumber(item.responses)}</td>
                        <td className="text-muted">{formatDateTime(item.lastResponseAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="detail-section">
            <div className="panel-header compact-panel-header">
              <div>
                <h3 className="section-title experiment-title">{t('surveyLatestResponses')}</h3>
                <p className="text-muted">{t('surveyLatestResponsesLead')}</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('created')}</th>
                    <th>{t('status')}</th>
                    <th>{t('answer')}</th>
                    <th>{t('page')}</th>
                    <th>{t('session')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.responses.length ? (
                    data.responses.map((response) => (
                      <tr key={response.id}>
                        <td className="text-muted">{formatDateTime(response.createdAt)}</td>
                        <td>
                          <span className="badge">
                            {response.completed ? t('surveyStatusComplete') : t('surveyStatusPartial')}
                          </span>
                          {response.source === 'hosted' ? <span className="badge">{t('surveySourceHosted')}</span> : null}
                        </td>
                        <td>
                          <dl className="survey-response-answers">
                            {questions
                              .filter((question) => response.answers[question.id] !== undefined)
                              .map((question) => (
                                <div key={question.id}>
                                  <dt className="text-muted">{question.question}</dt>
                                  <dd>{surveyAnswerText(response.answers[question.id])}</dd>
                                </div>
                              ))}
                          </dl>
                        </td>
                        <td className="text-muted">{response.urlPath ?? '-'}</td>
                        <td>
                          {response.sessionId ? (
                            <Link to={`/websites/${websiteId}/sessions/${response.sessionId}`} className="inline-link">
                              {response.sessionId.slice(0, 8)}
                              <ExternalLink size={12} strokeWidth={2} aria-hidden />
                            </Link>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-muted">
                        {t('surveyNoResponses')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
