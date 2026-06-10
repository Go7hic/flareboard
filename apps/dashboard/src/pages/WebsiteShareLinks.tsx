import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShareManage } from '../components/ShareManage';
import { WebsitePageShell } from '../components/WebsitePageShell';
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
    <div className="page page-share-links">
      <WebsitePageShell websiteId={websiteId} />
      <section className="panel section-gap">
        <h2 className="section-title">{t('sharePageTitle')}</h2>
        <p className="section-lead">{t('sharePageLead')}</p>
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
    </div>
  );
}
