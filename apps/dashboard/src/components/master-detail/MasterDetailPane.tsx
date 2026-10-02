import type { ReactNode } from 'react';

type MasterDetailPaneProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Badges and short facts under the title (status, key, created). */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

/** Detail card of a master–detail page: title, meta line, actions, then sections. */
export function MasterDetailPane({ title, description, meta, actions, children }: MasterDetailPaneProps) {
  return (
    <div className="master-detail-pane">
      <header className="master-detail-pane-head">
        <div className="master-detail-pane-copy">
          <h3 className="section-title experiment-title">{title}</h3>
          {meta ? <div className="meta-line master-detail-pane-meta">{meta}</div> : null}
          {description ? <p className="text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="master-detail-pane-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
