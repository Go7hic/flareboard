import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PropertyFilter } from '@flareboard/shared/insight-query';
import { DataViewState } from '../components/DataViewState';
import { PropertyFilterBuilder } from '../components/PropertyFilterBuilder';
import { RetentionHeatmap } from '../components/RetentionHeatmap';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Label } from '../components/ui/label';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { reportFiltersParam } from '../lib/websiteReportApi';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

export default function WebsiteRetentionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone, rangeQs } =
    useWebsiteReportContext('30d');
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const filtersQs = reportFiltersParam(filters);

  const retentionQuery = useQuery({
    queryKey: ['reports-retention', websiteId, range, segmentId, filtersQs],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<{ cohorts: Array<{ cohortWeek: string; weekOffset: number; users: number }> }>(
        reportUrl('retention', filtersQs),
      ),
  });

  return (
    <Page className="page-retention">
      <PageHeader
        title={t('retention')}
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
        <div className="field">
          <Label>{t('insightFilters')}</Label>
          <PropertyFilterBuilder websiteId={websiteId} rangeQs={rangeQs} value={filters} onChange={setFilters} />
        </div>
        <p className="text-muted field-hint">{t('retentionReportInsightHint')}</p>
      </section>
      <div className="section-gap">
        <DataViewState
          loading={retentionQuery.isLoading}
          error={retentionQuery.isError ? retentionQuery.error : null}
          onRetry={() => retentionQuery.refetch()}
          isEmpty={!retentionQuery.isLoading && (retentionQuery.data?.cohorts ?? []).length === 0}
          emptyTitle={t('noDataInPeriod')}
        >
          <RetentionHeatmap cohorts={retentionQuery.data?.cohorts ?? []} />
        </DataViewState>
      </div>
      </PageBody>
    </Page>
  );
}
