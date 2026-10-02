import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import type { UtmReportResponse } from '@flareboard/shared/client';
import { keepPreviousForWebsite } from '../components/audience/keepPrevious';
import { DimensionCard, splitUntagged, type DimensionRow } from '../components/audience/DimensionCard';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';

type UtmKey = 'source' | 'medium' | 'campaign' | 'content' | 'term';

/** Placeholders the API uses for pageviews without the tag. */
const UNTAGGED = ['(none)', '(direct)'] as const;

const DIMENSIONS: Array<{ key: UtmKey; label: () => string; param: string; span: string }> = [
  { key: 'source', label: () => t('source'), param: 'utm_source', span: 'span-4' },
  { key: 'medium', label: () => t('medium'), param: 'utm_medium', span: 'span-4' },
  { key: 'campaign', label: () => t('campaign'), param: 'utm_campaign', span: 'span-4' },
  { key: 'content', label: () => t('utmContent'), param: 'utm_content', span: 'span-6' },
  { key: 'term', label: () => t('utmTerm'), param: 'utm_term', span: 'span-6' },
];

function toRows(rows: Array<{ name: string; pageviews: number }> | undefined): DimensionRow[] {
  return (rows ?? []).map((row) => ({ name: row.name, value: row.pageviews }));
}

/** Top tagged value of a dimension, for the KPI strip. */
function topValue(rows: DimensionRow[]) {
  const { tagged } = splitUntagged(rows, UNTAGGED);
  const total = tagged.reduce((sum, row) => sum + row.value, 0);
  const top = tagged[0];
  return top ? { name: top.name, value: top.value, share: total > 0 ? (top.value / total) * 100 : 0 } : null;
}

export default function WebsiteUtmPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');

  const utmQuery = useQuery({
    queryKey: ['reports-utm', websiteId, range, segmentId],
    enabled: Boolean(websiteId),
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => api<UtmReportResponse>(reportUrl('utm')),
  });

  const data = utmQuery.data;
  const initialLoading = utmQuery.isLoading && !data;
  const rowsByKey = useMemo(
    () => Object.fromEntries(DIMENSIONS.map(({ key }) => [key, toRows(data?.[key])])) as Record<UtmKey, DimensionRow[]>,
    [data],
  );

  // Every pageview has exactly one source row (tagged or "(direct)"), so the source breakdown
  // gives both the total and the tagged share.
  const sourceRows = rowsByKey.source;
  const allPageviews = sourceRows.reduce((sum, row) => sum + row.value, 0);
  const taggedPageviews = splitUntagged(sourceRows, UNTAGGED).tagged.reduce((sum, row) => sum + row.value, 0);
  const anyTagged = DIMENSIONS.some(({ key }) => splitUntagged(rowsByKey[key], UNTAGGED).tagged.length > 0);

  const topCell = (label: string, rows: DimensionRow[]) => {
    const top = topValue(rows);
    return (
      <KpiCell
        label={label}
        value={top ? <span className="audience-kpi-text">{top.name}</span> : '-'}
        title={top?.name}
        hint={
          top
            ? t('audienceTopShareHint')
                .replace('{count}', formatNumber(top.value))
                .replace('{pct}', formatPercent(top.share))
            : t('audienceNoTagsShort')
        }
      />
    );
  };

  return (
    <Page className="page-utm">
      <PageHeader
        title={t('navUtm')}
        lead={t('audienceUtmLead')}
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

      <PageBody className="stack">
        <DataViewState
          error={utmQuery.isError && !data ? utmQuery.error : null}
          onRetry={() => utmQuery.refetch()}
        >
          {initialLoading ? (
            <KpiStripSkeleton cells={4} />
          ) : (
            <KpiStrip columns={4}>
              <KpiCell
                label={t('audienceTaggedPageviews')}
                value={formatNumber(taggedPageviews)}
                hint={t('audienceShareOfPageviews')
                  .replace('{pct}', formatPercent(allPageviews > 0 ? (taggedPageviews / allPageviews) * 100 : 0))
                  .replace('{total}', formatNumber(allPageviews))}
              />
              {topCell(t('audienceTopSource'), sourceRows)}
              {topCell(t('audienceTopMedium'), rowsByKey.medium)}
              {topCell(t('audienceTopCampaign'), rowsByKey.campaign)}
            </KpiStrip>
          )}

          {!initialLoading && !anyTagged ? (
            <EmptyState
              variant="rich"
              icon={<Tag />}
              title={t('audienceUtmEmptyTitle')}
              description={t('audienceUtmEmptyBody')}
            >
              <pre className="code-block audience-snippet">
                https://example.com/?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=spring_sale
              </pre>
            </EmptyState>
          ) : (
            <div className="layout-grid layout-grid--stretch" aria-label={t('utmBreakdown')}>
              {DIMENSIONS.map(({ key, label, param, span }) => (
                <DimensionCard
                  key={key}
                  className={span}
                  title={label()}
                  rows={rowsByKey[key]}
                  loading={initialLoading}
                  valueLabel={t('pageviews')}
                  untagged={UNTAGGED}
                  untaggedLabel={t('audienceUntagged')}
                  emptyIcon={<Tag />}
                  emptyTitle={t('audienceNoTagValues').replace('{param}', param)}
                  emptyDescription={t('audienceNoTagValuesHint').replace('{param}', param)}
                />
              ))}
            </div>
          )}
        </DataViewState>
      </PageBody>
    </Page>
  );
}
