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
  default: 'px-[1.2rem] py-[1.1rem]',
  hero: 'px-[1.5rem] py-[1.4rem]',
  secondary: 'px-[1.1rem] py-[0.95rem] shadow-none hover:shadow-none',
};

const sizeLabel: Record<StatCardSize, string> = {
  default: 'text-[0.6875rem]',
  hero: 'text-[0.6875rem]',
  secondary: 'text-[0.625rem]',
};

const sizeValue: Record<StatCardSize, string> = {
  default: 'text-[1.75rem] leading-[1.05]',
  hero: 'text-[2.125rem] leading-[1.05]',
  secondary: 'text-[1.375rem] leading-[1.1]',
};

const sizeDelta: Record<StatCardSize, string> = {
  default: 'text-[0.75rem]',
  hero: 'text-[0.75rem]',
  secondary: 'text-[0.625rem]',
};

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
        'rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]',
        sizeShell[size],
        size === 'default' && 'shadow-[var(--shadow-sm)]',
        'transition-[border-color,box-shadow] duration-200',
        size !== 'secondary' && 'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]',
        variant === 'primary' && 'border-[var(--border-strong)] bg-[var(--bg-subtle)]',
        className
      )}
      {...props}
    >
      <p
        className={cn(
          'font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]',
          sizeLabel[size]
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          'mt-[0.3rem] font-mono font-semibold tracking-[-0.03em] tabular-nums',
          sizeValue[size]
        )}
      >
        {value}
      </p>
      {delta !== undefined ? (
        <div
          className={cn(
            'mt-[0.4rem] font-mono tabular-nums whitespace-nowrap',
            sizeDelta[size],
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
        'rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)]',
        sizeShell[size],
        size === 'default' && 'shadow-[var(--shadow-sm)]',
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
