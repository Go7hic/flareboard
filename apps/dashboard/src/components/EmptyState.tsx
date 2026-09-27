import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * `inline` (default): dashed block inside a panel/table ("no data in this range").
 * `rich`: standalone panel for page-level empties (no websites, no boards, not found) —
 * children typically add `.empty-state-steps` and an `.empty-state-cta` button.
 */
export function EmptyState({
  title,
  description,
  children,
  variant = 'inline',
  tone = 'muted',
  as: Tag = 'div',
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  variant?: 'inline' | 'rich';
  /** `danger` colors the description (errors, access denied). */
  tone?: 'muted' | 'danger';
  as?: 'div' | 'li';
  className?: string;
}) {
  if (variant === 'rich') {
    return (
      <Tag className={cn('panel empty-state-rich', className)} role="status">
        <h3>{title}</h3>
        {description ? <p className={tone === 'danger' ? 'text-danger' : 'text-muted'}>{description}</p> : null}
        {children}
      </Tag>
    );
  }

  return (
    <Tag className={cn('empty-state-block', className)} role="status">
      <p className="empty-state-block-title">{title}</p>
      {description ? (
        <p className={cn('empty-state-block-desc', tone === 'danger' && 'text-danger')}>{description}</p>
      ) : null}
      {children}
    </Tag>
  );
}
