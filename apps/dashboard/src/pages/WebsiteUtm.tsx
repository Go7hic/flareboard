import { useQuery } from '@tanstack/react-query';
import type { UtmReportResponse } from '@flareboard/shared/client';
import { MetricsTable } from '../components/MetricsTable';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';

function breakdownRows(rows: Array<{ name: string; pageviews: number }>) {
  return rows.map((row) => ({ x: row.name, y: row.pageviews }));
}

function UtmDimensionPanel({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: Array<{ name: string; pageviews: number }>;
  loading?: boolean;
}) {
  return (
    <section className="panel overview-dimension-card">
      <h2 className="overview-dimension-card-title">{title}</h2>
      <MetricsTable
        embedded
        hideTitle
        maxRows={10}
        rows={breakdownRows(rows)}
        loading={loading}
        primaryMetric="views"
        title={title}
      />
    </section>
  );
}

const UTM_SECTIONS: Array<{ key: keyof Omit<UtmReportResponse, 'segmentId' | 'startAt' | 'endAt'>; labelKey: 'campaign' | 'utmContent' | 'medium' | 'source' | 'utmTerm' }> = [
  { key: 'campaign', labelKey: 'campaign' },
  { key: 'content', labelKey: 'utmContent' },
  { key: 'medium', labelKey: 'medium' },
  { key: 'source', labelKey: 'source' },
  { key: 'term', labelKey: 'utmTerm' },
];

export default function WebsiteUtmPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');

  const utmQuery = useQuery({
    queryKey: ['reports-utm', websiteId, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () => api<UtmReportResponse>(reportUrl('utm')),
  });

  const loading = utmQuery.isLoading;
  const data = utmQuery.data;

  return (
    <div className="page page-utm">
      <WebsitePageShell
        websiteId={websiteId}
        pageActions={
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

      <section className="panel section-gap">
        <p className="section-lead">{t('utmLead')}</p>
      </section>

      <div className="utm-dimensions-stack section-gap" aria-label={t('utmBreakdown')}>
        {UTM_SECTIONS.map(({ key, labelKey }) => (
          <UtmDimensionPanel
            key={key}
            title={t(labelKey)}
            rows={data?.[key] ?? []}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}
