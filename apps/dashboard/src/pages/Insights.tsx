import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, Line, LineChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import {
  MasterDetailLayout,
  MasterDetailListItem,
  MasterDetailPane,
} from '../components/master-detail';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { ProductLineCrossLinks } from '../components/ProductLineCrossLinks';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, type Insight, type InsightQuery, type InsightResult, type InsightType, type Website } from '../lib/api';
import { presetToRange, rangeQueryString } from '../lib/dateRange';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useChartColors } from '../lib/useChartColors';

const DEFAULT_QUERY: InsightQuery = {
  metric: 'pageviews',
  dimension: 'path',
  unit: 'day',
  actor: 'person',
  limit: 10,
  events: ['signup', 'purchase'],
};

function defaultName(type: InsightType) {
  switch (type) {
    case 'trend':
      return t('insightTypeTrend');
    case 'funnel':
      return t('insightTypeFunnel');
    case 'retention':
      return t('insightTypeRetention');
    case 'path':
      return t('insightTypePath');
    case 'stickiness':
      return t('insightTypeStickiness');
    case 'table':
      return t('insightTypeTable');
    default:
      return t('insight');
  }
}

function insightTypeLabel(type: InsightType) {
  return defaultName(type);
}

function funnelStepsFromQuery(events: string[] | undefined) {
  return events?.length ? events : ['signup', 'purchase'];
}

function ResultPreview({ result }: { result: InsightResult | null | undefined }) {
  const chartColors = useChartColors();
  if (!result) return <EmptyState title={t('insightPreviewEmptyTitle')} description={t('insightPreviewEmptyBody')} />;

  if (result.kind === 'trend') {
    return (
      <div className="chart-wrap chart-wrap-compact">
        <AnalyticsChart Chart={LineChart} data={result.series} margin={{ left: 8, right: 16 }} xAxis={{ dataKey: 'x' }}>
          <Line type="monotone" dataKey="y" stroke={chartColors.accent} strokeWidth={2} dot={false} />
        </AnalyticsChart>
      </div>
    );
  }

  if (result.kind === 'funnel') {
    const rows = result.steps.map((step) => ({ name: step.step, count: step.count }));
    return (
      <>
        <div className="chart-wrap chart-wrap-compact">
          <AnalyticsChart
            Chart={BarChart}
            data={rows}
            layout="vertical"
            margin={{ left: 8, right: 16 }}
            grid={{ horizontal: false }}
            xAxis={{ type: 'number' }}
            yAxis={{ type: 'category', dataKey: 'name', width: 110 }}
          >
            <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
          </AnalyticsChart>
        </div>
        <p className="text-muted">{t('overallConversion')}: {formatPercent(result.conversion)}</p>
      </>
    );
  }

  if (result.kind === 'stickiness') {
    const rows = result.distribution.map((row) => ({ name: `${row.activeDays}d`, actors: row.actors }));
    return (
      <div className="chart-wrap chart-wrap-compact">
        <AnalyticsChart Chart={BarChart} data={rows} margin={{ left: 8, right: 16 }} xAxis={{ dataKey: 'name' }}>
          <Bar dataKey="actors" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
        </AnalyticsChart>
      </div>
    );
  }

  if (result.kind === 'retention') {
    return <p className="text-muted">{t('insightRetentionPreview').replace('{count}', String(result.cohorts.length))}</p>;
  }

  if (result.kind === 'path') {
    return (
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('page')}</th>
              <th className="num">{t('visits')}</th>
            </tr>
          </thead>
          <tbody>
            {result.next.map((row) => (
              <tr key={row.path}>
                <td>{row.path}</td>
                <td className="num">{formatNumber(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('value')}</th>
            <th className="num">{t('events')}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.x}>
              <td>{row.x}</td>
              <td className="num">{formatNumber(row.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InsightsPage() {
  const queryClient = useQueryClient();
  const [websiteId, setWebsiteId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(defaultName('trend'));
  const [description, setDescription] = useState('');
  const [type, setType] = useState<InsightType>('trend');
  const [query, setQuery] = useState<InsightQuery>(DEFAULT_QUERY);

  const websitesQuery = useQuery({
    queryKey: ['websites'],
    queryFn: () => api<Website[]>('/api/websites'),
  });

  const websites = websitesQuery.data ?? [];
  const timezone = websites.find((w) => w.id === websiteId)?.timezone ?? 'UTC';
  const range = useMemo(() => presetToRange('30d', undefined, undefined, timezone), [timezone]);
  const rangeQs = rangeQueryString(range.startAt, range.endAt);
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');

  useEffect(() => {
    if (!websiteId && websites.length) {
      setWebsiteId(websites[0].id);
    }
  }, [websiteId, websites]);

  const insightsQuery = useQuery({
    queryKey: ['insights', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Insight[]>(`/api/insights?websiteId=${websiteId}`),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      api<{ data: InsightResult }>(`/api/insights/preview?websiteId=${websiteId}&${rangeQs}`, {
        method: 'POST',
        body: JSON.stringify({ type, query }),
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ websiteId, name, description, type, query });
      if (selectedId) {
        return api<Insight>(`/api/insights/${selectedId}`, { method: 'PATCH', body });
      }
      return api<Insight>('/api/insights', { method: 'POST', body });
    },
    onSuccess: (insight) => {
      setSelectedId(insight.id);
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/insights/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setSelectedId(null);
      setName(defaultName(type));
      queryClient.invalidateQueries({ queryKey: ['insights', websiteId] });
    },
  });

  function selectInsight(insight: Insight) {
    setSelectedId(insight.id);
    setWebsiteId(insight.websiteId);
    setName(insight.name);
    setDescription(insight.description);
    setType(insight.type);
    setQuery({ ...DEFAULT_QUERY, ...insight.query });
  }

  function newInsight(nextType: InsightType = 'trend') {
    setSelectedId(null);
    setType(nextType);
    setName(defaultName(nextType));
    setDescription('');
    setQuery(DEFAULT_QUERY);
  }

  return (
    <Page className="page-insights">
      <PageHeader
        title={t('insights')}
        lead={t('insightsSubtitle')}
        backTo="/websites"
        backLabel={t('websites')}
        meta={<ProductLineCrossLinks surface="insights" />}
      />

      <PageBody>
      {!canEdit ? <p className="text-muted section-gap">{t('viewOnlyHint')}</p> : null}

      <section className="panel section-gap">
        <MasterDetailLayout
          list={
            <DataViewState
              loading={insightsQuery.isLoading}
              error={insightsQuery.isError ? insightsQuery.error : null}
              onRetry={() => insightsQuery.refetch()}
              isEmpty={!insightsQuery.isLoading && !(insightsQuery.data ?? []).length}
              emptyTitle={t('insightsEmptyTitle')}
              emptyDescription={t('insightsEmptyBody')}
            >
              <>
                {(insightsQuery.data ?? []).map((insight) => (
                  <MasterDetailListItem
                    key={insight.id}
                    selected={selectedId === insight.id}
                    onSelect={() => selectInsight(insight)}
                    title={insight.name}
                    subtitle={insightTypeLabel(insight.type)}
                  />
                ))}
              </>
            </DataViewState>
          }
          detail={
            <MasterDetailPane
              title={selectedId ? t('editInsight') : t('createInsight')}
              description={t('insightBuilderLead')}
              actions={
                canEdit ? (
                  <Button type="button" variant="secondary" onClick={() => newInsight()}>
                    {t('newInsight')}
                  </Button>
                ) : null
              }
            >
            {canEdit ? (
            <>
            <div className="workflow-insights-grid">
              <div className="field">
                <Label htmlFor="insight-website">{t('website')}</Label>
                <select id="insight-website" className="select" value={websiteId} onChange={(event) => setWebsiteId(event.target.value)}>
                  {websites.map((website) => (
                    <option key={website.id} value={website.id}>{website.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <Label htmlFor="insight-type">{t('type')}</Label>
                <select
                  id="insight-type"
                  className="select"
                  value={type}
                  onChange={(event) => {
                    const next = event.target.value as InsightType;
                    setType(next);
                    if (!selectedId) setName(defaultName(next));
                  }}
                >
                  <option value="trend">{t('insightTypeTrend')}</option>
                  <option value="funnel">{t('insightTypeFunnel')}</option>
                  <option value="retention">{t('insightTypeRetention')}</option>
                  <option value="path">{t('insightTypePath')}</option>
                  <option value="stickiness">{t('insightTypeStickiness')}</option>
                  <option value="table">{t('insightTypeTable')}</option>
                </select>
              </div>
              <div className="field">
                <Label htmlFor="insight-name">{t('name')}</Label>
                <Input id="insight-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="field">
                <Label htmlFor="insight-description">{t('description')}</Label>
                <Input id="insight-description" value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
            </div>

            <div className="workflow-insights-grid">
              {type === 'funnel' ? (
                <div className="field">
                  <Label htmlFor="insight-events">{t('funnel')}</Label>
                  <EventCatalogPicker
                    mode="multi"
                    websiteId={websiteId}
                    id="insight-events"
                    value={funnelStepsFromQuery(query.events)}
                    onChange={(events) => setQuery((prev) => ({ ...prev, events }))}
                    placeholder={t('funnelStepsPlaceholder')}
                    aria-label={t('funnel')}
                  />
                </div>
              ) : type === 'table' ? (
                <div className="field">
                  <Label htmlFor="insight-dimension">{t('dimension')}</Label>
                  <select
                    id="insight-dimension"
                    className="select"
                    value={query.dimension ?? 'path'}
                    onChange={(event) => setQuery((prev) => ({ ...prev, dimension: event.target.value }))}
                  >
                    <option value="path">{t('page')}</option>
                    <option value="event">{t('event')}</option>
                    <option value="browser">{t('browser')}</option>
                    <option value="country">{t('country')}</option>
                    <option value="channel">{t('channel')}</option>
                  </select>
                </div>
              ) : type === 'path' ? (
                <div className="field">
                  <Label htmlFor="insight-path">{t('insightPathPrefix')}</Label>
                  <Input
                    id="insight-path"
                    value={query.path ?? ''}
                    onChange={(event) => setQuery((prev) => ({ ...prev, path: event.target.value }))}
                    placeholder="/pricing"
                  />
                </div>
              ) : type === 'trend' || type === 'stickiness' ? (
                <div className="field">
                  <Label htmlFor="insight-event">{t('event')}</Label>
                  <EventCatalogPicker
                    mode="single"
                    websiteId={websiteId}
                    id="insight-event"
                    value={query.event ?? ''}
                    onChange={(event) => setQuery((prev) => ({ ...prev, event }))}
                    placeholder={type === 'trend' ? t('insightTrendEventPlaceholder') : t('stickinessEventPlaceholder')}
                    allowEmpty={type === 'stickiness'}
                  />
                </div>
              ) : null}

              {type === 'trend' ? (
                <div className="field">
                  <Label htmlFor="insight-metric">{t('metric')}</Label>
                  <select
                    id="insight-metric"
                    className="select"
                    value={query.metric ?? 'pageviews'}
                    onChange={(event) => setQuery((prev) => ({ ...prev, metric: event.target.value as InsightQuery['metric'] }))}
                  >
                    <option value="pageviews">{t('pageviews')}</option>
                    <option value="visitors">{t('visitors')}</option>
                    <option value="events">{t('events')}</option>
                  </select>
                </div>
              ) : null}
            </div>

            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => previewMutation.mutate()} disabled={!websiteId || previewMutation.isPending}>
                {t('previewInsight')}
              </Button>
              <Button type="button" variant="primary" onClick={() => saveMutation.mutate()} disabled={!websiteId || !name.trim() || saveMutation.isPending}>
                {selectedId ? t('saveChanges') : t('saveInsight')}
              </Button>
              {selectedId ? (
                <Button type="button" variant="danger" onClick={() => deleteMutation.mutate(selectedId)}>
                  {t('delete')}
                </Button>
              ) : null}
            </div>
            <p className="text-muted insight-save-share-hint">
              {t('insightSaveShareHintBeforeBoards')}{' '}
              <Link to="/boards">{t('boards')}</Link>
              {t('insightSaveShareHintBeforeReports')}{' '}
              <Link to="/reports">{t('reports')}</Link>
              {t('insightSaveShareHintEnd')}
            </p>
            </>
            ) : null}

            <div className="detail-section">
              <div className="panel-header compact-panel-header">
                <div>
                  <h3 className="section-title experiment-title">{t('insightPreview')}</h3>
                  <p className="text-muted">{t('insightPreviewLead')}</p>
                </div>
              </div>
              <DataViewState
                loading={previewMutation.isPending}
                error={previewMutation.isError ? previewMutation.error : null}
                onRetry={() => previewMutation.mutate()}
              >
                <ResultPreview result={previewMutation.data?.data} />
              </DataViewState>
            </div>
            </MasterDetailPane>
          }
        />
      </section>
      </PageBody>
    </Page>
  );
}
