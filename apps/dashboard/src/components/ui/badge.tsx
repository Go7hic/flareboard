import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-[999px] px-2 py-0.5 text-[0.6875rem] font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)] border-opacity-20',
        secondary:
          'bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border)]',
        success:
          'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]',
        destructive:
          'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]',
        warning:
          'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]',
        outline:
          'border border-[var(--border)] text-[var(--text-muted)] bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
