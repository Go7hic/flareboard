import * as React from 'react';
import { Skeleton } from './skeleton';
import { cn } from '../../lib/utils';

type StatCardSize = 'default' | 'hero' | 'secondary';

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaDirection?: 'positive' | 'negative' | 'neutral';
  size?: StatCardSize;
  variant?: 'default' | 'primary';
  hint?: React.ReactNode;
}

const sizeShell: Record<StatCardSize, string> = {
  default: 'px-[1.25rem] py-[1rem]',
  hero: 'px-[1.25rem] py-[1.15rem]',
  secondary: 'px-[1rem] py-[0.85rem]',
};

const sizeValue: Record<StatCardSize, string> = {
  default: 'text-[1.75rem] leading-[1.1]',
  hero: 'text-[2.25rem] leading-[1.05]',
  secondary: 'text-[1.375rem] leading-[1.15]',
};

/**
 * A single figure in its own card (console v2). Prefer <KpiStrip> for a row of headline numbers;
 * StatCard is for a lone figure beside other content. Labels are sentence case, values use
 * proportional Geist Sans figures (tabular figures are for columns).
 */
function StatCard({
  label,
  value,
  delta,
  deltaDirection = 'neutral',
  size = 'default',
  variant = 'default',
  hint,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]',
        sizeShell[size],
        variant === 'primary' && 'bg-[var(--bg-subtle)]',
        className
      )}
      {...props}
    >
      <p className="truncate text-[0.8125rem] font-medium text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          'mt-[0.35rem] truncate font-semibold tracking-[-0.02em] text-[var(--text)]',
          sizeValue[size]
        )}
      >
        {value}
      </p>
      {delta !== undefined ? (
        <div
          className={cn(
            'mt-[0.4rem] text-[0.75rem] whitespace-nowrap [font-variant-numeric:tabular-nums]',
            deltaDirection === 'positive' && 'text-[var(--success)]',
            deltaDirection === 'negative' && 'text-[var(--danger)]',
            deltaDirection === 'neutral' && 'text-[var(--text-muted)]'
          )}
        >
          {delta}
        </div>
      ) : null}
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

function StatCardSkeleton({
  size = 'default',
  className,
}: {
  size?: StatCardSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]',
        sizeShell[size],
        className
      )}
      aria-hidden
    >
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="mt-[0.65rem] h-7 w-full" />
    </div>
  );
}

export { StatCard, StatCardSkeleton, type StatCardSize };
