import type { ReactNode } from 'react';

export function WebsitePageShell({
  websiteId,
  toolbar,
  pageActions,
}: {
  websiteId?: string;
  toolbar?: ReactNode;
  /** Top-right controls (stats filter, date range, export). */
  pageActions?: ReactNode;
}) {
  if (!websiteId || (!toolbar && !pageActions)) return null;

  return (
    <div className="website-page-chrome">
      {pageActions ? <div className="website-page-actions">{pageActions}</div> : null}
      {toolbar ? <div className="website-toolbar">{toolbar}</div> : null}
    </div>
  );
}
