import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from './PageHeader';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export function WebsitePageShell({
  websiteId,
  toolbar,
  headerActions,
  pageActions,
}: {
  websiteId?: string;
  toolbar?: ReactNode;
  headerActions?: ReactNode;
  /** Top-right controls (stats filter, date range, export). */
  pageActions?: ReactNode;
}) {
  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const site = websiteQuery.data;

  return (
    <>
      <PageHeader
        title={site?.name ?? t('website')}
        subtitle={site?.domain ?? undefined}
        actions={headerActions}
      />
      {websiteId && (toolbar || pageActions) ? (
        <div className="website-page-chrome">
          {pageActions ? <div className="website-page-actions">{pageActions}</div> : null}
          {toolbar ? <div className="website-toolbar">{toolbar}</div> : null}
        </div>
      ) : null}
    </>
  );
}
