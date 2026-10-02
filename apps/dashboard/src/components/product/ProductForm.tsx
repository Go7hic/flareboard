import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Title row of a dialog form section: title, one-line lead, an action on the right. */
export function FormSectionHead({
  title,
  lead,
  action,
  leadTone,
}: {
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  leadTone?: 'danger';
}) {
  return (
    <header className="product-form-section-head">
      <div>
        <h3 className="product-form-section-title">{title}</h3>
        {lead ? <p className={cn('product-form-section-lead', leadTone === 'danger' && 'text-danger')}>{lead}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** A dialog form section: hairline on top running to the dialog edges, head, then fields. */
export function FormSection({
  title,
  lead,
  action,
  leadTone,
  className,
  children,
}: {
  title?: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  leadTone?: 'danger';
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('product-form-section', className)}>
      {title ? <FormSectionHead title={title} lead={lead} action={action} leadTone={leadTone} /> : null}
      {children}
    </section>
  );
}

/** Validation summary shown after a save attempt. */
export function FormErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="product-form-errors" role="alert">
      {[...new Set(errors)].map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
