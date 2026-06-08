import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { WebsiteDateExportControls } from '../components/WebsiteDateExportControls';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { Panel } from '../components/ui/panel';
import { Skeleton } from '../components/ui/skeleton';
import { api, getToken } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsiteRange } from '../lib/useWebsiteRange';

interface PerformanceReport {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  samples: number;
  lcpSamples?: number;
  inpSamples?: number;
  clsSamples?: number;
  fcpSamples?: number;
  ttfbSamples?: number;
}

function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  return `${value} ms`;
}

function formatCls(value: number | null | undefined) {
  if (value == null) return '—';
  return String(value);
}

function VitalCard({
  label,
  value,
  samples,
  loading,
  primary,
}: {
  label: string;
  value: string;
  samples?: number;
  loading?: boolean;
  primary?: boolean;
}) {
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">
        {label}
        {samples != null && !loading ? (
          <span className="text-muted text-[0.78rem] font-normal"> ({samples})</span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-[0.65rem] h-7 w-full" />
      ) : (
        <div className="stat-value">{value}</div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const navigate = useNavigate();
  const { range, setRange, rangeQs } = useWebsiteRange(websiteId, '24h');

  useEffect(() => {
    if (!getToken()) navigate('/login');
  }, [navigate]);

  const performanceQuery = useQuery({
    queryKey: ['performance', websiteId, range],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<PerformanceReport>(
        `/api/reports/performance?websiteId=${websiteId}&${rangeQs}`,
      ),
  });

  const data = performanceQuery.data;
  const hasData = Boolean(data && data.samples > 0);
  const loading = performanceQuery.isLoading;
  const hasPartialData =
    hasData &&
    Boolean(
      data &&
        (data.lcp == null ||
          data.inp == null ||
          data.cls == null ||
          data.fcp == null ||
          data.ttfb == null),
    );

  return (
    <div className="page page-performance">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
          <WebsiteDateExportControls range={range} onRangeChange={setRange} />
        }
      />

      <Panel>
        <h2 className="section-title">{t('performance')}</h2>
        <p className="section-lead">{t('performancePageLead')}</p>

        <div className="analytics-hero-stats section-gap">
          <VitalCard
            label="LCP"
            value={formatMs(data?.lcp)}
            samples={data?.lcpSamples}
            loading={loading}
            primary
          />
          <VitalCard
            label="INP"
            value={formatMs(data?.inp)}
            samples={data?.inpSamples}
            loading={loading}
          />
          <VitalCard
            label="CLS"
            value={formatCls(data?.cls)}
            samples={data?.clsSamples}
            loading={loading}
          />
          <VitalCard
            label="FCP"
            value={formatMs(data?.fcp)}
            samples={data?.fcpSamples}
            loading={loading}
          />
          <VitalCard
            label="TTFB"
            value={formatMs(data?.ttfb)}
            samples={data?.ttfbSamples}
            loading={loading}
          />
          <VitalCard
            label={t('performanceEvents')}
            value={loading ? '—' : String(data?.samples ?? 0)}
            loading={loading}
          />
        </div>

        {!loading && hasPartialData ? (
          <p className="section-lead text-muted">{t('performancePartialHint')}</p>
        ) : null}

        {!loading && !hasData ? (
          <div className="panel empty-state-rich">
            <EmptyState
              title={t('noDataInPeriod')}
              description={t('noDataInPeriodHint')}
            />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
