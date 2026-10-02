import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';

/** Base UI Select needs a non-empty value for the "all" row; the caller only ever sees ''. */
const ALL = '__all__';

export type FilterOption = { value: string; label: ReactNode };

/**
 * Compact toolbar filter (console v2): a select button the height of the date range trigger.
 * With `allLabel`, an empty value means "no filter" and the trigger reads muted until a value is
 * picked; `active` overrides that for filters without an "all" row (error status).
 */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  label,
  active,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  allLabel?: ReactNode;
  /** Accessible name of the trigger. */
  label: string;
  active?: boolean;
  className?: string;
}) {
  const items = allLabel !== undefined ? [{ value: ALL, label: allLabel }, ...options] : options;
  const isActive = active ?? Boolean(value);
  return (
    <Select
      items={items}
      value={value || (allLabel !== undefined ? ALL : null)}
      onValueChange={(next) => onChange(next == null || next === ALL ? '' : String(next))}
    >
      <SelectTrigger className={cn('q-filter-trigger', isActive && 'is-active', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="q-filter-popup">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
