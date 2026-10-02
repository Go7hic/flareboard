import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { SectionHeader } from '../SectionCard';

/**
 * One section of a detail card (master–detail pane): a hairline above, a small header, then
 * the content. Keeps detail panes to one container level (no boxes inside the card).
 */
export function DetailSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('traffic-section', className)}>
      {title || description || actions ? (
        <SectionHeader title={title} description={description} actions={actions} headingLevel={3} />
      ) : null}
      {children}
    </section>
  );
}
