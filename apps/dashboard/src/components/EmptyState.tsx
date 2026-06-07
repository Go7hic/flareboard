import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state-block" role="status">
      <p className="empty-state-block-title">{title}</p>
      {description ? <p className="empty-state-block-desc">{description}</p> : null}
      {children}
    </div>
  );
}
