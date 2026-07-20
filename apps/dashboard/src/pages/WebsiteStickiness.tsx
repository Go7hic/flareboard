import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from '../components/EmptyState';
import { EventCatalogPicker } from '../components/EventCatalogPicker';
import { WebsitePageShell } from '../components/WebsitePageShell';
import { WebsiteReportControls } from '../components/WebsiteReportControls';
import { Label } from '../components/ui/label';
import { useWebsiteReportContext } from '../hooks/useWebsiteReportContext';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useChartColors } from '../lib/useChartColors';
import { chartTooltipStyle } from '../lib/chartStyles';
import { useDebouncedValue } from '../lib/useDebouncedValue';

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
    <div className="page page-stickiness">
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
        <header className="panel-header">
          <div>
            <h2 className="section-title">{t('stickiness')}</h2>
            <p className="text-muted">{t('stickinessLead')}</p>
          </div>
        </header>
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

      <section className="panel section-gap">
        {stickinessQuery.isLoading ? (
          <div className="skeleton skeleton-block" aria-busy />
        ) : !chartData.length ? (
          <EmptyState title={t('noDataInPeriod')} description={t('stickinessNoDataHint')} />
        ) : (
          <>
            <div className="detail-stats">
              <div>
                <span className="stat-label">{t('stickinessActors')}</span>
                <strong className="stat-value">{stickinessQuery.data?.totalActors.toLocaleString()}</strong>
              </div>
              <div>
                <span className="stat-label">{t('stickinessActorDays')}</span>
                <strong className="stat-value">{stickinessQuery.data?.actorDays.toLocaleString()}</strong>
              </div>
              <div>
                <span className="stat-label">{t('stickinessAverageDays')}</span>
                <strong className="stat-value">{stickinessQuery.data?.averageActiveDays.toFixed(2)}</strong>
              </div>
              <div>
                <span className="stat-label">{t('event')}</span>
                <strong className="stat-value">{stickinessQuery.data?.event ?? 'pageview'}</strong>
              </div>
            </div>

            <div className="chart-wrap chart-wrap-compact">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                  <YAxis tick={{ fontSize: 11, fill: chartColors.muted }} stroke={chartColors.border} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === 'percentage' ? [`${value}%`, t('percentage')] : [value, t('stickinessActors')]
                    }
                    contentStyle={chartTooltipStyle(chartColors, { fontSize: 13 })}
                  />
                  <Bar dataKey="actors" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                      <td className="num">{row.actors.toLocaleString()}</td>
                      <td className="num">{row.events.toLocaleString()}</td>
                      <td className="num">{row.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
