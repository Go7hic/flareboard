import { Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ActionDefinition, ActionRule } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { BreakdownList } from '../BreakdownList';
import { EmptyState } from '../EmptyState';
import { KpiCell, KpiStrip } from '../KpiStrip';
import { MasterDetailPane } from '../master-detail';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { actionFieldLabel } from './ActionFormDialog';
import { DetailSection } from './DetailSection';
import { countLabel, formatShare, relativeLabel } from './format';
import { RelativeTime } from './RelativeTime';
import { bucketKeys, bucketLabel, fillSeries } from './series';
import { TrendAreaChart } from './TrendAreaChart';

/** "Page path starts with /checkout" for list subtitles. */
export function ruleSummary(rule: ActionRule) {
  const field = rule.field === 'property' ? rule.key || t('actionFieldProperty') : actionFieldLabel(rule.field);
  return `${field} ${t(`actionOperator_${rule.operator}`)} ${rule.value}`;
}

export function ActionDetail({
  websiteId,
  action,
  startAt,
  endAt,
  totalVisits,
  refreshing = false,
  canEdit,
  onEdit,
  onDelete,
}: {
  websiteId: string;
  action: ActionDefinition;
  startAt: number;
  endAt: number;
  totalVisits: number | undefined;
  /** The summary is from the previous range while the new one loads. */
  refreshing?: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const summary = action.summary;
  const events = summary?.events ?? 0;

  // Daily buckets come back as UTC dates and only for days with matches.
  const trend = useMemo(() => {
    const keys = bucketKeys(startAt, endAt, 'day', 'UTC');
    if (keys.length < 2) return [];
    return fillSeries(
      (summary?.trend ?? []).map((point) => ({ x: point.date, y: point.events })),
      keys,
    ).map((point) => ({ label: bucketLabel(point.x, 'day', 'UTC'), value: point.y }));
  }, [summary?.trend, startAt, endAt]);

  const paths = summary?.paths ?? [];
  const maxPathEvents = Math.max(1, ...paths.map((path) => path.events));
  const recent = summary?.recent ?? [];

  return (
    <MasterDetailPane
      title={action.name}
      description={action.description || undefined}
      meta={
        <>
          <span>{countLabel('trafficRules', action.rules.length)}</span>
          {action.updatedAt ? (
            <span title={formatDateTime(action.updatedAt)}>
              {t('trafficUpdatedAgo').replace('{time}', relativeLabel(action.updatedAt))}
            </span>
          ) : null}
        </>
      }
      actions={
        canEdit ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil aria-hidden />
              {t('edit')}
            </Button>
            <Button type="button" variant="destructive-ghost" size="sm" onClick={onDelete}>
              <Trash2 aria-hidden />
              {t('delete')}
            </Button>
          </>
        ) : null
      }
    >
      <KpiStrip inline columns={4}>
        <KpiCell
          label={t('trafficMatches')}
          value={formatNumber(events)}
          hint={
            summary?.lastSeenAt
              ? t('trafficLastMatchAgo').replace('{time}', relativeLabel(summary.lastSeenAt))
              : t('actionNoMatches')
          }
        />
        <KpiCell label={t('sessions')} value={formatNumber(summary?.sessions ?? 0)} />
        <KpiCell label={t('visits')} value={formatNumber(summary?.visits ?? 0)} />
        <KpiCell
          label={t('trafficShareOfVisits')}
          value={formatShare(totalVisits ? (summary?.visits ?? 0) / totalVisits : null)}
          hint={
            totalVisits
              ? t('trafficShareOfVisitsHint')
                  .replace('{visits}', formatNumber(summary?.visits ?? 0))
                  .replace('{total}', formatNumber(totalVisits))
              : undefined
          }
        />
      </KpiStrip>

      {trend.length ? (
        <DetailSection title={t('trafficMatchesPerDay')}>
          {refreshing ? (
            <Skeleton className="h-[180px] w-full" />
          ) : events > 0 ? (
            <TrendAreaChart data={trend} name={t('trafficMatches')} height={180} />
          ) : (
            <p className="traffic-section-empty">{t('actionNoMatches')}</p>
          )}
        </DetailSection>
      ) : null}

      <DetailSection title={t('trafficDefinition')} description={t('trafficActionRulesHint')}>
        <ol className="traffic-rule-list">
          {action.rules.map((rule, index) => (
            <li key={index}>
              <span className="traffic-rule-field">
                {rule.field === 'property' ? (
                  <>
                    {t('actionFieldProperty')} <span className="mono">{rule.key}</span>
                  </>
                ) : (
                  actionFieldLabel(rule.field)
                )}
              </span>
              <span className="traffic-rule-operator">{t(`actionOperator_${rule.operator}`)}</span>
              <span className="traffic-chip mono">{rule.value}</span>
            </li>
          ))}
        </ol>
      </DetailSection>

      <DetailSection title={t('eventCatalogPaths')}>
        {paths.length ? (
          <BreakdownList
            labelHeader={t('page')}
            columns={[{ label: t('trafficMatches') }, { label: t('sessions') }]}
            items={paths.map((path) => ({
              id: path.path ?? '(none)',
              label: path.path || '-',
              title: path.path || undefined,
              mono: true,
              share: path.events / maxPathEvents,
              values: [formatNumber(path.events), formatNumber(path.sessions)],
            }))}
          />
        ) : (
          <p className="traffic-section-empty">{t('actionNoMatches')}</p>
        )}
      </DetailSection>

      <DetailSection title={t('trafficRecentMatches')}>
        {recent.length ? (
          <div className="table-scroll">
            <table className="data-table traffic-compact-table">
              <thead>
                <tr>
                  <th className="traffic-col-time">{t('trafficTime')}</th>
                  <th>{t('trafficEvent')}</th>
                  <th>{t('page')}</th>
                  <th className="traffic-col-session">{t('session')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 10).map((event) => (
                  <tr key={event.id}>
                    <td className="traffic-col-time">
                      <RelativeTime value={event.createdAt} format="short" className="text-muted" />
                    </td>
                    <td>
                      {event.eventName ? (
                        <span className="mono traffic-cell-truncate" title={event.eventName}>
                          {event.eventName}
                        </span>
                      ) : (
                        <span className="text-muted">{t('trafficKindPageview')}</span>
                      )}
                    </td>
                    <td>
                      <span className="mono traffic-cell-truncate text-muted" title={event.urlPath || undefined}>
                        {event.urlPath || '-'}
                      </span>
                    </td>
                    <td className="traffic-col-session">
                      <Link
                        to={`/websites/${websiteId}/sessions/${event.sessionId}`}
                        className="traffic-id-link mono"
                        title={event.sessionId}
                      >
                        {event.sessionId.slice(0, 8)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('actionNoMatches')} />
        )}
      </DetailSection>
    </MasterDetailPane>
  );
}
