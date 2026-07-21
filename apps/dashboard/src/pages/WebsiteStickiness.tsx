import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart } from 'recharts';
import { AnalyticsChart } from '../components/AnalyticsChart';
import { DataViewState } from '../components/DataViewState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Label } from '../components/ui/label';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { formatNumber, formatPercent } from '../lib/format';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';

type StickinessResponse = {
  event: string | null;
  actor: 'person' | 'session';
  startAt: number;
  endAt: number;
  totalActors: number;
  actorDays: number;
  averageActiveDays: number;
  distribution: Array<{
    activeDays: number;
    actors: number;
    events: number;
    percentage: number;
  }>;
};

export default function WebsiteStickinessPage() {
  const chartColors = useChartColors();
  const { websiteId, range, setRange, segmentId, setSegmentId, segments, reportUrl, timezone } =
    useWebsiteReportContext('30d');
  const [eventName, setEventName] = useState('');
  const [actor, setActor] = useState<'person' | 'session'>('person');
  const debouncedEventName = useDebouncedValue(eventName, 300);

  const stickinessQuery = useQuery({
    queryKey: ['reports-stickiness', websiteId, debouncedEventName, actor, range, segmentId],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<StickinessResponse>(
        reportUrl(
          'stickiness',
          `&actor=${actor}${debouncedEventName.trim() ? `&event=${encodeURIComponent(debouncedEventName.trim())}` : ''}`,
        ),
      ),
  });

  const chartData = useMemo(
    () =>
      (stickinessQuery.data?.distribution ?? []).map((row) => ({
        name: `${row.activeDays}d`,
        activeDays: row.activeDays,
        actors: row.actors,
        percentage: row.percentage,
      })),
    [stickinessQuery.data?.distribution],
  );

  return (
    <Page className="page-stickiness">
      <PageHeader
        title={t('stickiness')}
        lead={t('stickinessLead')}
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
            <Label htmlFor="stickiness-event">{t('stickinessEvent')}</Label>
            <EventCatalogPicker
              mode="single"
              websiteId={websiteId}
              id="stickiness-event"
              value={eventName}
              onChange={setEventName}
              placeholder={t('stickinessEventPlaceholder')}
              allowEmpty
            />
          </div>
          <div className="field">
            <Label htmlFor="stickiness-actor">{t('stickinessActor')}</Label>
            <select
              id="stickiness-actor"
              className="select"
              value={actor}
              onChange={(event) => setActor(event.target.value as 'person' | 'session')}
            >
              <option value="person">{t('stickinessActorPerson')}</option>
              <option value="session">{t('stickinessActorSession')}</option>
            </select>
          </div>
        </div>
      </section>

      <section className="section-gap">
        <DataViewState
          loading={stickinessQuery.isLoading}
          error={stickinessQuery.isError ? stickinessQuery.error : null}
          onRetry={() => stickinessQuery.refetch()}
          isEmpty={!stickinessQuery.isLoading && chartData.length === 0}
          emptyTitle={t('noDataInPeriod')}
          emptyDescription={t('stickinessNoDataHint')}
        >
          <>
            <div className="detail-stats">
              <div>
                <span className="stat-label">{t('stickinessActors')}</span>
                <strong className="stat-value">{formatNumber(stickinessQuery.data?.totalActors)}</strong>
              </div>
              <div>
                <span className="stat-label">{t('stickinessActorDays')}</span>
                <strong className="stat-value">{formatNumber(stickinessQuery.data?.actorDays)}</strong>
              </div>
              <div>
                <span className="stat-label">{t('stickinessAverageDays')}</span>
                <strong className="stat-value">
                  {formatNumber(stickinessQuery.data?.averageActiveDays, { maximumFractionDigits: 2 })}
                </strong>
              </div>
              <div>
                <span className="stat-label">{t('event')}</span>
                <strong className="stat-value">{stickinessQuery.data?.event ?? 'pageview'}</strong>
              </div>
            </div>

            <div className="chart-wrap chart-wrap-compact">
              <AnalyticsChart Chart={BarChart} data={chartData} margin={{ left: 8, right: 16 }} xAxis={{ dataKey: 'name' }}>
                <Bar dataKey="actors" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
              </AnalyticsChart>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('stickinessActiveDays')}</th>
                    <th className="num">{t('stickinessActors')}</th>
                    <th className="num">{t('events')}</th>
                    <th className="num">{t('percentage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(stickinessQuery.data?.distribution ?? []).map((row) => (
                    <tr key={row.activeDays}>
                      <td>{row.activeDays}</td>
                      <td className="num">{formatNumber(row.actors)}</td>
                      <td className="num">{formatNumber(row.events)}</td>
                      <td className="num">{formatPercent(row.percentage, { digits: 1 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        </DataViewState>
      </section>
      </PageBody>
    </Page>
  );
}
