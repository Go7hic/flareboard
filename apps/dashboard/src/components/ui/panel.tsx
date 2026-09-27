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
    // Same box as the legacy .panel class (6px radius, 1.5rem padding) so both read as one system.
    className={cn(
      variant === 'flush' ? 'panel-flush' : 'panel',
      variant === 'accent-rail' && 'panel-accent-rail',
      variant === 'danger-zone' && 'panel-danger-zone',
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
        'px-6 py-[0.9rem] border-b border-[var(--border-subtle)]',
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
    <div ref={ref} className={cn('p-6', className)} {...props} />
  )
);
PanelBody.displayName = 'PanelBody';

export { Panel, PanelHeader, PanelBody };
