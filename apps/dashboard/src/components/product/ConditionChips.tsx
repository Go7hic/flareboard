import { Fragment } from 'react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export type ChipCondition = {
  /** Already-translated field label ("Person property"). */
  field: string;
  /** Property / group key, shown in mono after the field. */
  subject?: string;
  /** Already-translated operator ("does not equal"). */
  operator: string;
  /** Omitted for exists / not exists. */
  value?: string;
  /** Values that are names (cohorts) rather than literals are not shown in mono. */
  plainValue?: boolean;
};

/**
 * Targeting conditions as chips joined by "and": field + key, operator, value. Read-only
 * summaries for flag condition groups, workflow filters and workflow condition steps.
 */
export function ConditionChips({
  conditions,
  emptyLabel,
  className,
}: {
  conditions: ChipCondition[];
  emptyLabel?: string;
  className?: string;
}) {
  if (!conditions.length) {
    return emptyLabel ? <p className={cn('product-chips-empty', className)}>{emptyLabel}</p> : null;
  }
  return (
    <div className={cn('product-chips', className)}>
      {conditions.map((condition, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="product-chip-join">{t('featureFlagAnd')}</span> : null}
          <span className="product-chip">
            <span className="product-chip-field">
              {condition.field}
              {condition.subject ? <span className="mono product-chip-subject">{condition.subject}</span> : null}
            </span>
            <span className="product-chip-op">{condition.operator}</span>
            {condition.value !== undefined && condition.value !== '' ? (
              <span className={cn('product-chip-value', !condition.plainValue && 'mono')}>{condition.value}</span>
            ) : null}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
