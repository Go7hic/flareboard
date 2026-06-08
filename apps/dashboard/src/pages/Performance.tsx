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
  loading,
  primary,
}: {
  label: string;
  value: string;
  loading?: boolean;
  primary?: boolean;
}) {
  return (
    <div className={`stat-card${primary ? ' stat-card-primary' : ''}`}>
      <div className="stat-label">{label}</div>
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
            loading={loading}
            primary
          />
          <VitalCard label="INP" value={formatMs(data?.inp)} loading={loading} />
          <VitalCard label="CLS" value={formatCls(data?.cls)} loading={loading} />
          <VitalCard label="FCP" value={formatMs(data?.fcp)} loading={loading} />
          <VitalCard label="TTFB" value={formatMs(data?.ttfb)} loading={loading} />
          <VitalCard
            label={t('samples')}
            value={loading ? '—' : String(data?.samples ?? 0)}
            loading={loading}
          />
        </div>

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
