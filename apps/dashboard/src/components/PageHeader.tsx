import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  actions,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
}) {
  return (
    <header className="page-header">
      {backTo ? (
        <Link to={backTo} className="page-back">
          ← {backLabel ?? 'Back'}
        </Link>
      ) : null}
      <div className="page-header-row">
        <div className="page-header-copy">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="page-header-toolbar">{toolbar}</div> : null}
    </header>
  );
}
