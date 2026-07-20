import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Panel — replaces .panel / .panel-flush with optional variants.
 * Keeps visual parity with the existing CSS panel styles.
 */
const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'flush' | 'accent-rail' | 'danger-zone';
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]',
      variant === 'default' && 'p-[1.35rem]',
      variant === 'flush' && 'overflow-hidden',
      variant === 'accent-rail' && 'p-[1.35rem]',
      variant === 'danger-zone' &&
        'p-[1.35rem] border-[color-mix(in_srgb,var(--danger)_40%,var(--border))]',
      className
    )}
    {...props}
  />
));
Panel.displayName = 'Panel';

const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-[1.35rem] py-[0.9rem] border-b border-[var(--border-subtle)]',
        'text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]',
        className
      )}
      {...props}
    />
  )
);
PanelHeader.displayName = 'PanelHeader';

const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-[1.35rem]', className)} {...props} />
  )
);
PanelBody.displayName = 'PanelBody';

export { Panel, PanelHeader, PanelBody };
