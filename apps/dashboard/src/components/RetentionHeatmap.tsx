import { formatRate } from './behavior/format';
import {
  RETENTION_RAMP,
  retentionRampStep,
  type RetentionMatrix,
} from './behavior/retention-matrix';
import { formatNumber, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';

export type RetentionDisplay = 'percent' | 'count';

/** Slot-1 ramp mixed into the card surface; steps stop at 68% so ink text stays readable. */
function rampBackground(step: number): string | undefined {
  return step > 0 ? `color-mix(in srgb, var(--chart-1) ${Math.round(step * 100)}%, var(--bg-elevated))` : undefined;
}

function cellText(users: number | null, pct: number | null, display: RetentionDisplay) {
  if (users == null) return '';
  return display === 'percent' ? formatRate(pct) : formatNumber(users);
}

/**
 * Cohort table (console v2): one row per weekly cohort (start date and size), one column per
 * week after it, each cell on a one-hue sequential ramp scaled to the table's best week.
 * The first row is the size-weighted average of every cohort that reached that week.
 */
export function RetentionHeatmap({ matrix, display }: { matrix: RetentionMatrix; display: RetentionDisplay }) {
  const { cohorts, offsets, averages, maxPct } = matrix;
  if (!cohorts.length) return null;

  return (
    <div className="table-scroll table-scroll--flush">
      <table className="data-table behavior-retention-table">
        <thead>
          <tr>
            <th scope="col">{t('insightCohort')}</th>
            {offsets.map((offset) => (
              <th key={offset} scope="col" className="num">
                {t('insightPeriodShort_week').replace('{n}', String(offset))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offsets.length ? (
            <tr className="behavior-retention-average">
              <th scope="row">
                <span className="behavior-retention-cohort">{t('behaviorRetentionAverage')}</span>
                <span className="behavior-retention-size">{t('behaviorRetentionAverageHint')}</span>
              </th>
              {averages.map((average) => (
                <td key={average.offset} className="num">
                  <span
                    className="behavior-retention-chip"
                    style={{ background: rampBackground(retentionRampStep(average.pct, maxPct)) }}
                    title={t('behaviorRetentionCellTitle')
                      .replace('{users}', formatNumber(average.users))
                      .replace('{size}', formatNumber(average.size))
                      .replace('{pct}', formatRate(average.pct))}
                  >
                    {average.cohorts ? cellText(average.users, average.pct, display) : ''}
                  </span>
                </td>
              ))}
            </tr>
          ) : null}
          {cohorts.map((cohort) => (
            <tr key={cohort.week}>
              <th scope="row">
                <span className="behavior-retention-cohort" title={cohort.week}>
                  {formatShortDate(cohort.startMs, { timeZone: 'UTC' })}
                </span>
                <span className="behavior-retention-size">
                  {formatNumber(cohort.size)} {t('retentionUsers')}
                </span>
              </th>
              {cohort.cells.map((cell) => (
                <td key={cell.offset} className="num">
                  {cell.users == null ? (
                    <span className="behavior-retention-chip is-empty" aria-label={t('behaviorRetentionNotYet')} />
                  ) : (
                    <span
                      className={`behavior-retention-chip${cell.inProgress ? ' is-partial' : ''}`}
                      style={{ background: rampBackground(retentionRampStep(cell.pct, maxPct)) }}
                      title={`${t('behaviorRetentionCellTitle')
                        .replace('{users}', formatNumber(cell.users))
                        .replace('{size}', formatNumber(cohort.size))
                        .replace('{pct}', formatRate(cell.pct))}${cell.inProgress ? ` · ${t('behaviorRetentionInProgress')}` : ''}`}
                    >
                      {cellText(cell.users, cell.pct, display)}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Scale legend for the ramp, plus the in-progress marker. */
export function RetentionLegend({ maxPct }: { maxPct: number }) {
  return (
    <div className="behavior-retention-legend">
      <span className="behavior-retention-legend-scale">
        <span>0%</span>
        {RETENTION_RAMP.map((step) => (
          <span key={step} className="behavior-retention-legend-step" style={{ background: rampBackground(step) }} aria-hidden />
        ))}
        <span>{formatRate(maxPct)}</span>
      </span>
      <span className="behavior-retention-legend-partial">
        <span className="behavior-retention-legend-dot" aria-hidden />
        {t('behaviorRetentionInProgress')}
      </span>
    </div>
  );
}
