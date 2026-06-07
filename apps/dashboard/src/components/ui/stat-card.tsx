import * as React from 'react';
import { cn } from '../../lib/utils';

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaDirection?: 'positive' | 'negative' | 'neutral';
}

function StatCard({ label, value, delta, deltaDirection = 'neutral', className, ...props }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]',
        'px-[1.2rem] py-[1.1rem] shadow-[var(--shadow-sm)]',
        'transition-[border-color,box-shadow] duration-200',
        'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]',
        className
      )}
      {...props}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-[0.3rem] font-mono text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      {delta !== undefined ? (
        <p
          className={cn(
            'mt-[0.4rem] font-mono text-[0.75rem] tabular-nums',
            deltaDirection === 'positive' && 'text-[var(--success)]',
            deltaDirection === 'negative' && 'text-[var(--danger)]',
            deltaDirection === 'neutral' && 'text-[var(--text-muted)]'
          )}
        >
          {delta}
        </p>
      ) : null}
    </div>
  );
}

export { StatCard };
