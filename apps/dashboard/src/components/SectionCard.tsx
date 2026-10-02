import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * A titled card: the one container level of console v2 (docs/dashboard-design-system.md).
 * `flush` drops the body padding for tables and row lists that run edge to edge.
 */
export function SectionCard({
  title,
  description,
  actions,
  footer,
  flush = false,
  className,
  bodyClassName,
  id,
  as: Tag = 'section',
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
  as?: 'section' | 'div' | 'article';
  children?: ReactNode;
}) {
  const header =
    title || description || actions ? (
      <SectionHeader title={title} description={description} actions={actions} />
    ) : null;

  if (flush) {
    return (
      <Tag id={id} className={cn('panel-flush', className)}>
        {header}
        <div className={bodyClassName}>{children}</div>
        {footer ? <div className="card-footer">{footer}</div> : null}
      </Tag>
    );
  }

  return (
    <Tag id={id} className={cn('panel', className)}>
      {header}
      {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
      {footer ? <div className="card-footer">{footer}</div> : null}
    </Tag>
  );
}

/** Card title row: title + optional description on the left, actions on the right. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={cn('card-header', className)}>
      <div className="card-header-copy">
        {title ? <Heading className="card-title">{title}</Heading> : null}
        {description ? <p className="card-description">{description}</p> : null}
      </div>
      {actions ? <div className="card-actions">{actions}</div> : null}
    </div>
  );
}
