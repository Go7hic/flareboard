import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart } from 'recharts';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { formatDurationShort } from '../components/InsightResultView';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Label } from '../components/ui/label';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api, type EventCatalogResponse } from '../lib/api';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { reportFiltersParam } from '../lib/websiteReportApi';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

type FunnelResponse = {
  steps: Array<{
    step: string;
    count: number;
    rate: number;
    avgTimeToConvertMs?: number | null;
    medianTimeToConvertMs?: number | null;
  }>;
  conversion: number;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Conversion windows offered on the report page (the insight builder takes any value). */
const WINDOW_OPTIONS = [HOUR, DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY];

function windowLabel(ms: number) {
  return ms < DAY ? t('funnelWindowHours').replace('{n}', String(ms / HOUR)) : t('funnelWindowDays').replace('{n}', String(ms / DAY));
}

/**
 * Opening steps when the URL names none: `signup` → `purchase` when the website sends both,
 * otherwise its three custom events reached by the most sessions (busiest first, which is
 * usually the order of a funnel).
 */
function defaultFunnelSteps(events: EventCatalogResponse['events'] | undefined): string[] {
  if (!events) return [];
  const custom = events.filter((event) => !event.eventName.startsWith('$'));
  const names = new Set(custom.map((event) => event.eventName));
  if (names.has('signup') && names.has('purchase')) return ['signup', 'purchase'];
  return [...custom].sort((a, b) => b.sessions - a.sessions).slice(0, 3).map((event) => event.eventName);
}

export default function WebsiteFunnelPage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [searchParams] = useSearchParams();
  // Saved funnel reports open with `?steps=a,b,c`; otherwise start from the website's own events.
  const [editedSteps, setFunnelSteps] = useState<string[] | null>(() => {
    const fromUrl = (searchParams.get('steps') ?? '')
      .split(',')
      .map((step) => step.trim())
      .filter(Boolean);
    return fromUrl.length ? fromUrl : null;
  });
  // Same query key as EventCatalogPicker, so the picker reuses this response.
  const catalogQuery = useQuery({
    queryKey: ['event-catalog', websiteId, ''],
    enabled: Boolean(websiteId) && editedSteps === null,
    queryFn: () => api<EventCatalogResponse>(`/api/websites/${websiteId}/events/catalog`),
  });
  const funnelSteps = editedSteps ?? defaultFunnelSteps(catalogQuery.data?.events);
  const [countBy, setCountBy] = useState<'session' | 'person'>('session');
  const [order, setOrder] = useState<'strict' | 'any'>('strict');
  const [windowMs, setWindowMs] = useState(90 * DAY);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);

  const funnelStepsParam = funnelSteps.join(',');
  const filtersQs = reportFiltersParam(filters);
  const optionsQs = `&countBy=${countBy}&order=${order}&windowMs=${windowMs}`;

  const funnelQuery = useQuery({
    queryKey: ['reports-funnel', websiteId, funnelStepsParam, range, segmentId, optionsQs, filtersQs],
    enabled: Boolean(websiteId) && funnelSteps.length > 0,
    queryFn: () =>
      api<FunnelResponse>(reportUrl('funnel', `&steps=${encodeURIComponent(funnelStepsParam)}${optionsQs}${filtersQs}`)),
  });

  const funnelChartData = useMemo(
    () => (funnelQuery.data?.steps ?? []).map((s) => ({ name: s.step, count: s.count })),
    [funnelQuery.data?.steps],
  );

  const funnelHasData = useMemo(
    () => (funnelQuery.data?.steps ?? []).some((s) => s.count > 0),
    [funnelQuery.data?.steps],
  );

  return (
    <Page className="page-funnel">
      <PageHeader
        title={t('funnel')}
        actions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
            timezone={timezone}
          />
        }
      />

      <PageBody>
      <section className="panel section-gap">
        <div className="panel-form">
          <div className="field">
            <Label htmlFor="funnel-steps">{t('insightSteps')}</Label>
            <EventCatalogPicker
              mode="multi"
              id="funnel-steps"
              websiteId={websiteId}
              value={funnelSteps}
              onChange={setFunnelSteps}
              placeholder={t('funnelStepsPlaceholder')}
              aria-label={t('funnel')}
            />
          </div>
          <div className="workflow-insights-grid">
            <div className="field">
              <Label htmlFor="funnel-count-by">{t('insightCountBy')}</Label>
              <select
                id="funnel-count-by"
                className="select"
                value={countBy}
                onChange={(event) => setCountBy(event.target.value as 'session' | 'person')}
              >
                <option value="session">{t('insightCountSessions')}</option>
                <option value="person">{t('insightCountPeople')}</option>
              </select>
            </div>
            <div className="field">
              <Label htmlFor="funnel-order">{t('insightStepOrder')}</Label>
              <select
                id="funnel-order"
                className="select"
                value={order}
                onChange={(event) => setOrder(event.target.value as 'strict' | 'any')}
              >
                <option value="strict">{t('insightOrderStrict')}</option>
                <option value="any">{t('insightOrderAny')}</option>
              </select>
            </div>
            <div className="field">
              <Label htmlFor="funnel-window">{t('insightConversionWindow')}</Label>
              <select
                id="funnel-window"
                className="select"
                value={windowMs}
                onChange={(event) => setWindowMs(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((ms) => (
                  <option key={ms} value={ms}>
                    {windowLabel(ms)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <Label>{t('insightFilters')}</Label>
            <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
          </div>
        </div>
      </section>
      <div className="section-gap">
        <DataViewState
          loading={funnelQuery.isLoading || (editedSteps === null && catalogQuery.isLoading)}
          error={funnelQuery.isError ? funnelQuery.error : null}
          onRetry={() => funnelQuery.refetch()}
          isEmpty={!funnelQuery.isLoading && (funnelChartData.length === 0 || !funnelHasData)}
          emptyTitle={t('noDataInPeriod')}
          emptyDescription={
            funnelChartData.length > 0 ? t('funnelNoDataHint') : t('noDataInPeriodHint')
          }
        >
          <>
            <div className="chart-wrap chart-wrap-compact">
              <AnalyticsChart
                Chart={BarChart}
                data={funnelChartData}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
                grid={{ horizontal: false }}
                xAxis={{ type: 'number' }}
                yAxis={{ type: 'category', dataKey: 'name', width: 100 }}
              >
                <Bar dataKey="count" fill={chartColors.accent} radius={[0, 4, 4, 0]} />
              </AnalyticsChart>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('insightStep')}</th>
                    <th className="num">{countBy === 'person' ? t('insightCountPeople') : t('insightCountSessions')}</th>
                    <th className="num">{t('insightStepConversion')}</th>
                    <th className="num">{t('insightAvgTimeToConvert')}</th>
                    <th className="num">{t('insightMedianTimeToConvert')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(funnelQuery.data?.steps ?? []).map((s, index) => (
                    <tr key={`${s.step}-${index}`}>
                      <td>{s.step}</td>
                      <td className="num">{formatNumber(s.count)}</td>
                      <td className="num">{formatPercent(s.rate)}</td>
                      <td className="num">{index === 0 ? '-' : formatDurationShort(s.avgTimeToConvertMs)}</td>
                      <td className="num">{index === 0 ? '-' : formatDurationShort(s.medianTimeToConvertMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {funnelQuery.data ? (
              <p className="text-muted reports-funnel-conversion">
                {t('overallConversion')}: {formatPercent(funnelQuery.data.conversion)}
              </p>
            ) : null}
          </>
        </DataViewState>
      </div>
      </PageBody>
    </Page>
  );
}
