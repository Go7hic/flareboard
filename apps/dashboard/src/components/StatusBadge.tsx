import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Small tinted status label (console v2): running / draft / stopped, healthy / failing, etc.
 * Color only reinforces the text, never replaces it. `dot={false}` for plain labels.
 */
export function StatusBadge({
  tone = 'neutral',
  dot = true,
  children,
  className,
  title,
}: {
  tone?: StatusTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn('status-badge', tone !== 'neutral' && `status-badge--${tone}`, !dot && 'status-badge--plain', className)}
      title={title}
    >
      {children}
    </span>
  );
}
