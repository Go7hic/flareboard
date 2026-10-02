import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SectionHeader } from '../SectionCard';

/**
 * A section of a detail card: a hairline on top that runs to the card edges, an optional
 * title row (title, description, actions on the right), then the content. No nested boxes.
 */
export function ProductSection({
  title,
  description,
  actions,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <section className={cn('product-section', className)} aria-label={ariaLabel}>
      {title || description || actions ? (
        <SectionHeader
          className="product-section-head"
          headingLevel={3}
          title={title}
          description={description}
          actions={actions}
        />
      ) : null}
      {children}
    </section>
  );
}

export type CalloutTone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * One-line answer or alert inside a detail card (experiment decision, sample ratio mismatch,
 * flag health). A tinted strip, not a box: no border, status color only on the icon.
 */
export function ProductCallout({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  role,
  className,
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const fallbackIcon =
    tone === 'success' ? (
      <CheckCircle2 strokeWidth={2} aria-hidden />
    ) : tone === 'warning' || tone === 'danger' ? (
      <AlertTriangle strokeWidth={2} aria-hidden />
    ) : (
      <Info strokeWidth={2} aria-hidden />
    );
  return (
    <div className={cn('product-callout', `product-callout--${tone}`, className)} role={role}>
      <span className="product-callout-icon">{icon ?? fallbackIcon}</span>
      <div className="product-callout-copy">
        <p className="product-callout-title">{title}</p>
        {children ? <div className="product-callout-body">{children}</div> : null}
      </div>
      {actions ? <div className="product-callout-actions">{actions}</div> : null}
    </div>
  );
}

/** Muted one-liner under a section (method notes, sampling notes, limits). */
export function ProductNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('product-note', className)}>{children}</p>;
}
