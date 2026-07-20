import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

/**
 * Unified title row for app pages.
 * Title + muted lead + actions on one row; optional toolbar (filters) below.
 * Prefer this over ad-hoc `h1`/`h2.page-title` or actions-only WebsitePageShell chrome.
 */
export function PageHeader({
  title,
  lead,
  subtitle,
  backTo,
  backLabel,
  actions,
  toolbar,
  meta,
  className,
}: {
  title: ReactNode;
  /** Muted one-line page purpose under the title. Preferred over `subtitle`. */
  lead?: ReactNode;
  /** @deprecated Prefer `lead`. Kept for existing call sites. */
  subtitle?: ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
  /** Secondary filter / control bar under the title row. */
  toolbar?: ReactNode;
  /** Optional strip under the lead (e.g. product-line cross-links). */
  meta?: ReactNode;
  className?: string;
}) {
  const description = lead ?? subtitle;

  return (
    <header className={cn('page-header', className)}>
      {backTo ? (
        <Link to={backTo} className="page-back">
          ← {backLabel ?? 'Back'}
        </Link>
      ) : null}
      <div className="page-header-row">
        <div className="page-header-copy">
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-subtitle">{description}</p> : null}
          {meta ? <div className="page-header-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="page-header-toolbar">{toolbar}</div> : null}
    </header>
  );
}
