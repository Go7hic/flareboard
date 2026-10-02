import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Compact query builder card of the behavior reports (funnel, journeys, retention, stickiness):
 * one card, a label column on the left and the controls on the right, hairline-free rows.
 */
export function QueryCard({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={cn('panel behavior-query', className)} aria-label={label}>
      {children}
    </section>
  );
}

export function QueryRow({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  /** Points the label at a single control; rows of several controls leave it out. */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('behavior-query-row', className)}>
      {htmlFor ? (
        <label className="behavior-query-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="behavior-query-label">{label}</span>
      )}
      <div className="behavior-query-control">{children}</div>
    </div>
  );
}

export type InlineSelectOption = { value: string; label: string };

/** A select with its label inside the control ("Count by  Sessions ▾"), for option rows. */
export function InlineSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn('behavior-inline-select', className)}>
      <span className="behavior-inline-select-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Two to four mutually exclusive options as a segmented control (console v2 `.segmented`). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('segmented', className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
