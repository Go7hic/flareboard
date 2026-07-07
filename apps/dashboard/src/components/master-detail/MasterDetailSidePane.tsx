import type { ReactNode } from 'react';

type MasterDetailSidePaneProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function MasterDetailSidePane({
  title,
  description,
  actions,
  children,
  className,
}: MasterDetailSidePaneProps) {
  return (
    <div className={['master-detail-side-pane', 'error-issue-samples', className].filter(Boolean).join(' ')}>
      <div className="error-issue-samples-head master-detail-side-pane-head">
        <div>
          <h3 className="section-title experiment-title">{title}</h3>
          {description ? <p className="text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
