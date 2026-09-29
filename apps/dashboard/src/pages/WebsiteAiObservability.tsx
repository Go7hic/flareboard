import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { DataViewState } from '../components/DataViewState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SegmentTabs } from '../components/SegmentTabs';
import { Button } from '../components/ui/button';
import { LlmOverview } from '../components/llm/LlmOverview';
import { LlmSettings } from '../components/llm/LlmSettings';
import { EMPTY_TRACE_FILTERS, LlmTraces, type TraceFilters } from '../components/llm/LlmTraces';
import { LlmUsers } from '../components/llm/LlmUsers';
import { api, type AiObservabilityResponse } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';
import { useWebsiteRange } from '../lib/useWebsiteRange';

const TABS = ['overview', 'traces', 'users', 'settings'] as const;
type Tab = (typeof TABS)[number];

const OVERVIEW_FILTERS = ['model', 'provider', 'status', 'release', 'environment', 'quality'] as const;
type OverviewFilter = (typeof OVERVIEW_FILTERS)[number];

export default function WebsiteAiObservabilityPage() {
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange, rangeQs, timezone } = useWebsiteRange(websiteId, '24h');
  const { canEdit } = useWebsitePermissions(websiteId, 'settings');

  const tabParam = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'overview';
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const [overviewFilters, setOverviewFilters] = useState<Record<OverviewFilter, string>>({
    model: '',
    provider: '',
    status: '',
    release: '',
    environment: '',
    quality: '',
  });
  const [traceFilters, setTraceFilters] = useState<TraceFilters>(() => ({
    ...EMPTY_TRACE_FILTERS,
    distinctId: searchParams.get('distinctId') ?? '',
  }));
  const [tracesKey, setTracesKey] = useState(0);

  const qs = useMemo(() => {
    const params = new URLSearchParams(rangeQs);
    for (const key of OVERVIEW_FILTERS) if (overviewFilters[key]) params.set(key, overviewFilters[key]);
    return params.toString();
  }, [overviewFilters, rangeQs]);

  const overview = useQuery({
    queryKey: ['ai-observability', websiteId, range, qs],
    enabled: Boolean(websiteId),
    queryFn: () => api<AiObservabilityResponse>(`/api/websites/${websiteId}/ai-observability?${qs}`),
    placeholderData: keepPreviousData,
  });
  const stats = overview.data?.stats;

  const options: Record<OverviewFilter, string[]> = {
    model: (stats?.models ?? []).map((row) => row.model),
    provider: (stats?.providers ?? []).map((row) => row.provider),
    status: (stats?.statuses ?? []).map((row) => row.status),
    release: (stats?.releases ?? []).map((row) => row.release),
    environment: (stats?.environments ?? []).map((row) => row.environment),
    quality: (stats?.qualities ?? []).map((row) => row.quality),
  };
  const allLabel: Record<OverviewFilter, string> = {
    model: t('allModels'),
    provider: t('allProviders'),
    status: t('allStatuses'),
    release: t('allReleases'),
    environment: t('allEnvironments'),
    quality: t('allQualities'),
  };
  const hasOverviewFilters = Object.values(overviewFilters).some(Boolean);

  return (
    <Page className="page-ai-observability">
      <PageHeader
        title={t('aiObservability')}
        lead={t('aiObservabilityLead')}
        actions={<WebsiteDateExportControls range={range} onRangeChange={setRange} timezone={timezone} />}
      />

      <PageBody>
        <div className="llm-toolbar section-gap">
          <SegmentTabs
            aria-label={t('aiObservability')}
            size="sm"
            value={tab}
            onChange={(id) => setTab(id as Tab)}
            tabs={[
              { id: 'overview', label: t('aiTabOverview') },
              { id: 'traces', label: t('aiTabTraces') },
              { id: 'users', label: t('aiTabUsers') },
              { id: 'settings', label: t('aiTabSettings') },
            ]}
          />
          {tab === 'overview' ? (
            <div className="logs-filter-row">
              {OVERVIEW_FILTERS.map((key) =>
                options[key].length > 1 || overviewFilters[key] ? (
                  <select
                    key={key}
                    className="select logs-level-select"
                    value={overviewFilters[key]}
                    aria-label={allLabel[key]}
                    onChange={(event) => setOverviewFilters((current) => ({ ...current, [key]: event.target.value }))}
                  >
                    <option value="">{allLabel[key]}</option>
                    {options[key].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : null,
              )}
              {hasOverviewFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setOverviewFilters({ model: '', provider: '', status: '', release: '', environment: '', quality: '' })}
                >
                  {t('reset')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {tab === 'overview' ? (
          <DataViewState loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()}>
            <LlmOverview websiteId={websiteId} stats={stats} events={overview.data?.events ?? []} />
          </DataViewState>
        ) : null}

        {tab === 'traces' ? (
          <LlmTraces
            key={tracesKey}
            websiteId={websiteId}
            rangeQs={rangeQs}
            rangeKey={range}
            models={options.model}
            filters={traceFilters}
            onFiltersChange={setTraceFilters}
          />
        ) : null}

        {tab === 'users' ? (
          <LlmUsers
            websiteId={websiteId}
            rangeQs={rangeQs}
            rangeKey={range}
            onViewTraces={(distinctId) => {
              setTraceFilters({ ...EMPTY_TRACE_FILTERS, distinctId });
              setTracesKey((key) => key + 1);
              setTab('traces');
            }}
          />
        ) : null}

        {tab === 'settings' ? <LlmSettings websiteId={websiteId} canEdit={canEdit} /> : null}
      </PageBody>
    </Page>
  );
}
