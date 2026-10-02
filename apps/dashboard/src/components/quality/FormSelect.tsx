import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';

const EMPTY = '__none__';

/**
 * Full-width select for forms (dialogs, sheets, settings cards), same height as Input. An option
 * with value '' is allowed ("All", "None"): it is mapped to a sentinel for Base UI.
 */
export function FormSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const items = options.map((option) => ({ value: option.value === '' ? EMPTY : option.value, label: option.label }));
  return (
    <Select
      items={items}
      value={value === '' ? EMPTY : value}
      disabled={disabled}
      onValueChange={(next) => onChange(next == null || next === EMPTY ? '' : String(next))}
    >
      <SelectTrigger id={id} className={cn('q-form-select', className)} aria-label={ariaLabel}>
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
