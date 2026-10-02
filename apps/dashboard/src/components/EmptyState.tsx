import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * `inline` (default): quiet centered block inside a card ("no data in this range").
 * `rich`: standalone card for page-level empties (no websites, no boards, not found) —
 * children typically add `.empty-state-steps` and an `.empty-state-cta` button.
 *
 * Console v2: an optional `icon` (a lucide icon element) sits in a small tile above the title,
 * and `action` renders a primary next step under the description.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  children,
  variant = 'inline',
  tone = 'muted',
  as: Tag = 'div',
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  variant?: 'inline' | 'rich';
  /** `danger` colors the description (errors, access denied). */
  tone?: 'muted' | 'danger';
  as?: 'div' | 'li';
  className?: string;
}) {
  const iconTile = icon ? (
    <span className="empty-icon" aria-hidden>
      {icon}
    </span>
  ) : null;
  const actions = action ? <div className="empty-state-actions">{action}</div> : null;

  if (variant === 'rich') {
    return (
      <Tag className={cn('panel empty-state-rich', className)} role="status">
        {iconTile}
        <h3>{title}</h3>
        {description ? <p className={tone === 'danger' ? 'text-danger' : 'text-muted'}>{description}</p> : null}
        {actions}
        {children}
      </Tag>
    );
  }

  return (
    <Tag className={cn('empty-state-block', className)} role="status">
      {iconTile}
      <p className="empty-state-block-title">{title}</p>
      {description ? (
        <p className={cn('empty-state-block-desc', tone === 'danger' && 'text-danger')}>{description}</p>
      ) : null}
      {actions}
      {children}
    </Tag>
  );
}
