import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShareManage } from '../components/ShareManage';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { api, type ShareLink, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export default function WebsiteShareLinksPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const websiteQuery = useQuery({
    queryKey: ['website', websiteId],
    enabled: Boolean(websiteId),
    queryFn: () => api<Website>(`/api/websites/${websiteId}`),
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      api<ShareLink>('/api/share', {
        method: 'POST',
        body: JSON.stringify({
          websiteId,
          name: `${websiteQuery.data?.name ?? t('website')} stats`,
        }),
      }),
    onSuccess: (share) => {
      const url = `${window.location.origin}/share/${share.slug}`;
      setShareUrl(url);
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });

  return (
    <Page className="page-share-links">
      <PageHeader title={t('sharePageTitle')} lead={t('sharePageLead')} />

      <PageBody>
      <section className="panel section-gap">
        {websiteId ? <ShareManage websiteId={websiteId} /> : null}
        <div className="share-create-block">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={shareMutation.isPending}
            onClick={() => shareMutation.mutate()}
          >
            {t('createShareLink')}
          </Button>
          {shareUrl ? (
            <p className="share-create-url">
              <a href={shareUrl}>{shareUrl}</a>
            </p>
          ) : null}
          {shareMutation.error ? (
            <p className="text-danger">{(shareMutation.error as Error).message}</p>
          ) : null}
        </div>
      </section>
      </PageBody>
    </Page>
  );
}
