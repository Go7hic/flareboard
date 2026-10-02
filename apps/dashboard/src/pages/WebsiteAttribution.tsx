import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Megaphone, MousePointerClick, Route, Tag } from 'lucide-react';
import type { AttributionConversionResponse } from '@flareboard/shared/client';
import { keepPreviousForWebsite } from '../components/audience/keepPrevious';
import { DimensionCard } from '../components/audience/DimensionCard';
import { Segmented } from '../components/audience/Segmented';
import { DataViewState } from '../components/DataViewState';
import { EmptyState } from '../components/EmptyState';
import { KpiCell, KpiStrip, KpiStripSkeleton } from '../components/KpiStrip';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Input } from '../components/ui/input';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cn } from '../lib/utils';

type AttributionModel = 'first' | 'last';
type AttributionType = 'path' | 'event';

/** API placeholders for a touch without the tag / without a referrer. */
const NO_TAG = ['(none)', '(direct)'] as const;
const DIRECT = '(direct)';

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

function formatReferrer(name: string) {
  return name === DIRECT ? t('revenueAttributionDirect') : name;
}

/** UTM breakdowns of the attributed touch; titles reuse the insight dimension labels ("UTM source"). */
const UTM_CARDS: Array<{
  key: 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term';
  span: string;
}> = [
  { key: 'utm_source', span: 'span-4' },
  { key: 'utm_medium', span: 'span-4' },
  { key: 'utm_campaign', span: 'span-4' },
  { key: 'utm_content', span: 'span-6' },
  { key: 'utm_term', span: 'span-6' },
];

export default function WebsiteAttributionPage() {
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');
  const [searchParams] = useSearchParams();
  const initialModel = searchParams.get('model') === 'first' ? 'first' : 'last';
  const initialType = searchParams.get('type') === 'path' ? 'path' : 'event';
  const initialStep = searchParams.get('step')?.trim() || 'purchase';
  const [model, setModel] = useState<AttributionModel>(initialModel);
  const [convType, setConvType] = useState<AttributionType>(initialType);
  const [step, setStep] = useState(initialStep);

  // Typing a step name should not fire a report request per keystroke.
  const debouncedStep = useDebouncedValue(step);
  const queryExtra = useMemo(() => {
    const params = new URLSearchParams();
    params.set('model', model);
    params.set('type', convType);
    params.set('step', debouncedStep.trim());
    return `&${params.toString()}`;
  }, [model, convType, debouncedStep]);

  const attributionQuery = useQuery({
    queryKey: ['reports-attribution', websiteId, range, segmentId, model, convType, debouncedStep],
    enabled: Boolean(websiteId) && debouncedStep.trim().length > 0,
    // Switching the model or editing the step keeps the last result until the new one lands.
    placeholderData: keepPreviousForWebsite(websiteId),
    queryFn: () => api<AttributionConversionResponse>(reportUrl('attribution', queryExtra)),
  });

  const data = attributionQuery.data;
  const hasStep = step.trim().length > 0;
  const initialLoading = hasStep && attributionQuery.isLoading && !data;
  const refreshing = attributionQuery.isFetching && attributionQuery.isPlaceholderData;
  const conversions = data?.total.conversions ?? 0;
  const anyUtmTagged = UTM_CARDS.some(({ key }) =>
    (data?.[key] ?? []).some((row) => !(NO_TAG as readonly string[]).includes(row.name)),
  );
  const pagesPerConversion = conversions > 0 ? (data?.total.pageviews ?? 0) / conversions : 0;

  return (
    <Page className="page-attribution">
      <PageHeader
        title={t('navAttribution')}
        lead={t('attributionLead')}
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
        <section className="panel audience-query" aria-label={t('audienceAttributionQuery')}>
          <div className="audience-query-field">
            <span className="audience-query-label" id="attribution-model-label">
              {t('audienceAttributionModel')}
            </span>
            <Segmented
              aria-label={t('audienceAttributionModel')}
              value={model}
              onChange={setModel}
              options={[
                { id: 'last', label: t('attributionModelLast') },
                { id: 'first', label: t('attributionModelFirst') },
              ]}
            />
          </div>
          <div className="audience-query-field audience-query-field--grow">
            <label className="audience-query-label" htmlFor="attribution-step">
              {t('audienceConvertsOn')}
            </label>
            <Segmented
              aria-label={t('audienceConvertsOn')}
              value={convType}
              onChange={setConvType}
              options={[
                { id: 'event', label: t('attributionTypeEvent') },
                { id: 'path', label: t('attributionTypePath') },
              ]}
            />
            <Input
              id="attribution-step"
              className="audience-query-input mono"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              placeholder={
                convType === 'path' ? t('attributionStepPathPlaceholder') : t('attributionStepEventPlaceholder')
              }
              aria-describedby="attribution-model-hint"
            />
          </div>
          <p className="audience-query-hint" id="attribution-model-hint">
            {model === 'first' ? t('audienceModelFirstHint') : t('audienceModelLastHint')}
          </p>
        </section>

        {!hasStep ? (
          <EmptyState
            variant="rich"
            icon={convType === 'path' ? <Route /> : <MousePointerClick />}
            title={t('audienceEnterStepTitle')}
            description={t('audienceEnterStepBody')}
          />
        ) : (
          <DataViewState
            error={attributionQuery.isError && !data ? attributionQuery.error : null}
            onRetry={() => attributionQuery.refetch()}
          >
            <div className={cn('stack', refreshing && 'audience-refreshing')} aria-busy={refreshing || undefined}>
              {initialLoading ? (
                <KpiStripSkeleton cells={4} />
              ) : (
                <KpiStrip columns={4}>
                  <KpiCell label={t('attributionConversions')} value={formatNumber(conversions)} />
                  <KpiCell label={t('audienceConvertingVisitors')} value={formatNumber(data?.total.visitors ?? 0)} />
                  <KpiCell
                    label={t('audienceConvertingPageviews')}
                    value={formatNumber(data?.total.pageviews ?? 0)}
                  />
                  <KpiCell
                    label={t('audiencePagesPerConversion')}
                    value={conversions > 0 ? formatNumber(pagesPerConversion, { maximumFractionDigits: 1 }) : '-'}
                  />
                </KpiStrip>
              )}

              {!initialLoading && conversions === 0 ? (
                <EmptyState
                  variant="rich"
                  icon={convType === 'path' ? <Route /> : <MousePointerClick />}
                  title={t('audienceNoConversionsTitle').replace('{step}', debouncedStep.trim())}
                  description={t('audienceNoConversionsBody')}
                />
              ) : (
                <div className="layout-grid layout-grid--stretch">
                  <DimensionCard
                    className="span-6"
                    title={t('attributionSectionSource')}
                    rows={data?.referrer ?? []}
                    loading={initialLoading}
                    valueLabel={t('attributionConversions')}
                    formatName={formatReferrer}
                    emptyTitle={t('noDataInPeriod')}
                  />
                  <DimensionCard
                    className="span-6"
                    title={t('attributionSectionPaidAds')}
                    rows={data?.paidAds ?? []}
                    loading={initialLoading}
                    valueLabel={t('attributionConversions')}
                    formatName={formatPaidAdsLabel}
                    emptyIcon={<Megaphone />}
                    emptyTitle={t('audienceNoPaidAdsTitle')}
                    emptyDescription={t('audienceNoPaidAdsBody')}
                  />
                  {!initialLoading && !anyUtmTagged ? (
                    <SectionCard className="span-12" title={t('attributionSectionUtm')}>
                      <EmptyState
                        icon={<Tag />}
                        title={t('audienceNoTaggedConversionsTitle')}
                        description={t('audienceNoTaggedConversions')}
                      />
                    </SectionCard>
                  ) : null}
                  {(initialLoading || anyUtmTagged ? UTM_CARDS : []).map(({ key, span }) => (
                    <DimensionCard
                      key={key}
                      className={span}
                      title={t(`insightDimension_${key}`)}
                      rows={data?.[key] ?? []}
                      loading={initialLoading}
                      valueLabel={t('attributionConversions')}
                      untagged={NO_TAG}
                      untaggedLabel={t('audienceUntagged')}
                      emptyIcon={<Tag />}
                      emptyTitle={t('audienceNoTagValues').replace('{param}', key)}
                      emptyDescription={t('audienceNoTaggedConversions')}
                    />
                  ))}
                </div>
              )}
            </div>
          </DataViewState>
        )}
      </PageBody>
    </Page>
  );
}
