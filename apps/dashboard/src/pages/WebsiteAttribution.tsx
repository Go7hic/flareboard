import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AttributionConversionResponse } from '@flareboard/shared';
import { EmptyState } from '../components/EmptyState';
import { MetricsTable } from '../components/MetricsTable';
import { SegmentTabs } from '../components/SegmentTabs';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

type AttributionModel = 'first' | 'last';
type AttributionType = 'path' | 'event';

function formatPaidAdsLabel(name: string) {
  switch (name) {
    case 'Google Ads':
      return t('paidAdsGoogle');
    case 'Microsoft Ads':
      return t('paidAdsMicrosoft');
    case 'Meta Ads':
      return t('paidAdsMeta');
    case 'TikTok Ads':
      return t('paidAdsTikTok');
    case 'X Ads':
      return t('paidAdsX');
    default:
      return name;
  }
}

function breakdownRows(rows: Array<{ name: string; value: number }>, formatName?: (name: string) => string) {
  return rows.map((row) => ({
    x: formatName ? formatName(row.name) : row.name,
    y: row.value,
  }));
}

function StatCard({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value.toLocaleString()}</div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="stat-card stat-card-skeleton" aria-hidden>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-[0.65rem] h-7 w-full" />
    </div>
  );
}

function BreakdownPanel({
  title,
  rows,
  loading,
  formatName,
}: {
  title: string;
  rows: Array<{ name: string; value: number }>;
  loading?: boolean;
  formatName?: (name: string) => string;
}) {
  return (
    <section className="panel overview-dimension-card">
      <h2 className="overview-dimension-card-title">{title}</h2>
      <MetricsTable
        embedded
        hideTitle
        maxRows={10}
        rows={breakdownRows(rows, formatName)}
        loading={loading}
        primaryMetric="views"
        title={title}
      />
    </section>
  );
}

export default function WebsiteAttributionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl } =
    useWebsiteReportContext('30d');
  const [searchParams] = useSearchParams();
  const initialModel = searchParams.get('model') === 'first' ? 'first' : 'last';
  const initialType = searchParams.get('type') === 'path' ? 'path' : 'event';
  const initialStep = searchParams.get('step')?.trim() || 'purchase';
  const [model, setModel] = useState<AttributionModel>(initialModel);
  const [convType, setConvType] = useState<AttributionType>(initialType);
  const [step, setStep] = useState(initialStep);

  const queryExtra = useMemo(() => {
    const params = new URLSearchParams();
    params.set('model', model);
    params.set('type', convType);
    params.set('step', step.trim());
    return `&${params.toString()}`;
  }, [model, convType, step]);

  const attributionQuery = useQuery({
    queryKey: ['reports-attribution', websiteId, range, segmentId, model, convType, step],
    enabled: Boolean(websiteId) && step.trim().length > 0,
    queryFn: () => api<AttributionConversionResponse>(reportUrl('attribution', queryExtra)),
  });

  const data = attributionQuery.data;
  const loading = attributionQuery.isLoading;
  const hasConversions = (data?.total.conversions ?? 0) > 0;

  return (
    <div className="page page-attribution">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteReportControls
            range={range}
            onRangeChange={setRange}
            segmentId={segmentId}
            onSegmentChange={setSegmentId}
            segments={segments}
          />
        }
      />

      <section className="panel section-gap">
        <p className="section-lead">{t('attributionLead')}</p>
        <div className="stats-toolbar attribution-filters" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <SegmentTabs
            tabs={[
              { id: 'last', label: t('attributionModelLast') },
              { id: 'first', label: t('attributionModelFirst') },
            ]}
            value={model}
            onChange={(id) => setModel(id as AttributionModel)}
            aria-label={t('attribution')}
          />
          <SegmentTabs
            tabs={[
              { id: 'event', label: t('attributionTypeEvent') },
              { id: 'path', label: t('attributionTypePath') },
            ]}
            value={convType}
            onChange={(id) => setConvType(id as AttributionType)}
            aria-label={t('attributionStep')}
          />
          <div className="field" style={{ minWidth: '14rem', flex: '1 1 14rem', maxWidth: '24rem' }}>
            <label className="field-label" htmlFor="attribution-step">
              {t('attributionStep')}
            </label>
            <Input
              id="attribution-step"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              placeholder={
                convType === 'path'
                  ? t('attributionStepPathPlaceholder')
                  : t('attributionStepEventPlaceholder')
              }
            />
          </div>
        </div>
      </section>

      <section className="analytics-hero-stats section-gap">
        {loading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard label={t('attributionConversions')} value={data?.total.conversions ?? 0} primary />
            <StatCard label={t('visitors')} value={data?.total.visitors ?? 0} />
            <StatCard label={t('visits')} value={data?.total.visits ?? 0} />
            <StatCard label={t('pageviews')} value={data?.total.pageviews ?? 0} />
          </>
        )}
      </section>

      {!step.trim() ? (
        <EmptyState title={t('attributionStep')} description={t('attributionStepEventPlaceholder')} />
      ) : loading ? (
        <div className="overview-dimensions-grid section-gap">
          <div className="panel skeleton skeleton-block" aria-busy />
          <div className="panel skeleton skeleton-block" aria-busy />
        </div>
      ) : !hasConversions ? (
        <EmptyState title={t('noDataInPeriod')} />
      ) : (
        <>
          <div className="overview-dimensions-grid section-gap">
            <BreakdownPanel
              title={t('attributionSectionSource')}
              rows={data?.referrer ?? []}
              loading={loading}
            />
            <BreakdownPanel
              title={t('attributionSectionPaidAds')}
              rows={data?.paidAds ?? []}
              loading={loading}
              formatName={formatPaidAdsLabel}
            />
          </div>

          <section className="section-gap" aria-label={t('attributionSectionUtm')}>
            <h2 className="section-title">{t('attributionSectionUtm')}</h2>
            <div className="overview-dimensions-grid">
              <BreakdownPanel title={t('source')} rows={data?.utm_source ?? []} loading={loading} />
              <BreakdownPanel title={t('medium')} rows={data?.utm_medium ?? []} loading={loading} />
              <BreakdownPanel title={t('campaign')} rows={data?.utm_campaign ?? []} loading={loading} />
              <BreakdownPanel title={t('utmContent')} rows={data?.utm_content ?? []} loading={loading} />
              <BreakdownPanel title={t('utmTerm')} rows={data?.utm_term ?? []} loading={loading} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
