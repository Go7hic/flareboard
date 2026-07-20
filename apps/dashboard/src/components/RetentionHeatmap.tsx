import { useMemo } from 'react';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

type RetentionRow = { cohortWeek: string; weekOffset: number; users: number };

function cellColor(intensity: number): string {
  const pct = Math.round(intensity * 100);
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-subtle))`;
}

export function RetentionHeatmap({ cohorts }: { cohorts: RetentionRow[] }) {
  const { weeks, offsets, matrix, maxUsers } = useMemo(() => {
    const weekSet = new Set<string>();
    const offsetSet = new Set<number>();
    for (const c of cohorts) {
      weekSet.add(c.cohortWeek);
      offsetSet.add(c.weekOffset);
    }
    const weeks = [...weekSet].sort();
    const offsets = [...offsetSet].sort((a, b) => a - b);
    const lookup = new Map(cohorts.map((c) => [`${c.cohortWeek}:${c.weekOffset}`, c.users]));
    const matrix = weeks.map((w) => offsets.map((o) => lookup.get(`${w}:${o}`) ?? 0));
    const maxUsers = Math.max(...cohorts.map((c) => c.users), 1);
    return { weeks, offsets, matrix, maxUsers };
  }, [cohorts]);

  if (!cohorts.length) return null;

  return (
    <div className="retention-heatmap-wrap">
      <div className="table-scroll">
        <table className="data-table retention-heatmap">
          <thead>
            <tr>
              <th>{t('retentionCohortWeek')}</th>
              {offsets.map((o) => (
                <th key={o} className="num">
                  W{o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={week}>
                <td className="retention-heatmap-week">{week}</td>
                {offsets.map((o, oi) => {
                  const users = matrix[wi]?.[oi] ?? 0;
                  const intensity = users / maxUsers;
                  return (
                    <td
                      key={o}
                      className="num retention-heatmap-cell"
                      style={{ background: cellColor(intensity) }}
                      title={`${formatNumber(users)} ${t('retentionUsers')}`}
                    >
                      {users > 0 ? formatNumber(users) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatmap-legend retention-heatmap-legend">
        <span>{t('heatmapLegendLow')}</span>
        <div className="heatmap-legend-steps" aria-hidden>
          {[0.15, 0.4, 0.7, 1].map((intensity) => (
            <span
              key={intensity}
              className="heatmap-legend-step"
              style={{ background: cellColor(intensity) }}
            />
          ))}
        </div>
        <span>{t('heatmapLegendHigh')}</span>
      </div>
    </div>
  );
}
