import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from './PageHeader';
import { WebsiteSubNav } from './WebsiteSubNav';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export function WebsitePageShell({
  websiteId,
  toolbar,
}: {
  websiteId?: string;
  toolbar?: ReactNode;
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
      />
      {websiteId ? (
        <div className="website-page-chrome">
          <WebsiteSubNav />
          {toolbar ? <div className="website-toolbar">{toolbar}</div> : null}
        </div>
      ) : null}
    </>
  );
}
