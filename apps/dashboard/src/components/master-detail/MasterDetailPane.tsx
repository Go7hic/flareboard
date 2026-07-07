import type { ReactNode } from 'react';

type MasterDetailPaneProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function MasterDetailPane({ title, description, actions, children }: MasterDetailPaneProps) {
  return (
    <div className="master-detail-pane">
      <header className="master-detail-pane-head">
        <div>
          <h3 className="section-title experiment-title">{title}</h3>
          {description ? <p className="text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
