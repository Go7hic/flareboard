import { ArrowDown } from 'lucide-react';
import { Fragment } from 'react';
import { formatDurationShort } from '../InsightResultView';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { formatRate } from './format';

export type FunnelStepData = {
  step: string;
  count: number;
  avgTimeToConvertMs?: number | null;
  /** Median time from entering the funnel to reaching this step. */
  medianTimeToConvertMs?: number | null;
};

function share(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Ordered funnel (dataviz: ordered stages → bars with conversion labels): one row per step with
 * its number, the event name, a bar of the units that reached it against everyone who entered,
 * conversion from the previous and the first step, and the drop-off between steps in muted text.
 */
export function FunnelSteps({ steps, unitLabel }: { steps: FunnelStepData[]; unitLabel: string }) {
  const first = steps[0]?.count ?? 0;

  return (
    <div className="behavior-funnel" role="table" aria-label={t('funnel')}>
      <div className="behavior-funnel-head" role="row">
        <span role="columnheader">{t('insightStep')}</span>
        <span role="columnheader">{unitLabel}</span>
        <span role="columnheader">{t('behaviorFunnelFromPrevious')}</span>
        <span role="columnheader">{t('behaviorFunnelFromFirst')}</span>
        <span role="columnheader">{t('insightMedianTimeToConvert')}</span>
      </div>
      {steps.map((step, index) => {
        const previous = index > 0 ? (steps[index - 1]?.count ?? 0) : step.count;
        const dropped = Math.max(previous - step.count, 0);
        const fromFirst = share(step.count, first);
        const fromPrevious = share(step.count, previous);
        const median = index > 0 ? step.medianTimeToConvertMs : null;
        const avg = index > 0 ? step.avgTimeToConvertMs : null;
        return (
          <Fragment key={`${step.step}-${index}`}>
            {index > 0 ? (
              <div className="behavior-funnel-drop" role="row">
                <span role="cell">
                  <ArrowDown aria-hidden strokeWidth={2} />
                  {t('behaviorFunnelDropped')
                    .replace('{n}', formatNumber(dropped))
                    .replace('{pct}', formatRate(share(dropped, previous)))}
                </span>
              </div>
            ) : null}
            <div className="behavior-funnel-step" role="row">
              <div className="behavior-funnel-step-main" role="cell">
                <div className="behavior-funnel-step-label">
                  <span className="behavior-funnel-step-num">{index + 1}</span>
                  <span className="behavior-funnel-step-name" title={step.step}>
                    {step.step}
                  </span>
                </div>
                <span
                  className="behavior-funnel-bar"
                  role="meter"
                  aria-label={`${step.step}: ${formatRate(fromFirst)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(fromFirst)}
                >
                  <span style={{ width: `${Math.min(100, fromFirst)}%` }} />
                </span>
              </div>
              <span role="cell" className="behavior-funnel-count" data-label={unitLabel}>
                {formatNumber(step.count)}
              </span>
              <span role="cell" className="behavior-funnel-num" data-label={t('behaviorFunnelFromPrevious')}>
                {index > 0 ? formatRate(fromPrevious) : '—'}
              </span>
              <span role="cell" className="behavior-funnel-num" data-label={t('behaviorFunnelFromFirst')}>
                {formatRate(fromFirst)}
              </span>
              <span
                role="cell"
                className="behavior-funnel-num"
                data-label={t('insightMedianTimeToConvert')}
                title={avg != null ? `${t('insightAvgTimeToConvert')} ${formatDurationShort(avg)}` : undefined}
              >
                {median != null ? formatDurationShort(median) : '—'}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
