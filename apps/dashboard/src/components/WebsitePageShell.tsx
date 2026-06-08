import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from './PageHeader';
import { WebsiteSubNav } from './WebsiteSubNav';
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
  /** Top-right controls beside website sub-nav (stats filter, date range, export). */
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
        backTo="/websites"
        backLabel={t('websites')}
        actions={headerActions}
      />
      {websiteId ? (
        <div className="website-page-chrome">
          <div className="website-page-chrome-top">
            <WebsiteSubNav />
            {pageActions ? <div className="website-page-actions">{pageActions}</div> : null}
          </div>
          {toolbar ? <div className="website-toolbar">{toolbar}</div> : null}
        </div>
      ) : null}
    </>
  );
}
