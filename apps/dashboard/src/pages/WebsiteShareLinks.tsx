import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Plus } from 'lucide-react';
import { shareUrl, ShareManage } from '../components/ShareManage';
import { Page, PageBody } from '../components/Page';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { CopyButton } from '../components/quality/CopyButton';
import { api, type ShareLink, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export default function WebsiteShareLinksPage() {
  const { websiteId = '' } = useParams<{ websiteId: string }>();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<ShareLink | null>(null);

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
      setCreated(share);
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });

  const create = () => shareMutation.mutate();

  return (
    <Page className="q-page q-page--share">
      <PageHeader
        title={t('sharePageTitle')}
        lead={t('sharePageLead')}
        actions={
          <Button type="button" size="sm" disabled={shareMutation.isPending || !websiteId} onClick={create}>
            <Plus aria-hidden />
            {t('createShareLink')}
          </Button>
        }
      />

      <PageBody className="stack">
        {created ? (
          <div className="q-callout" role="status">
            <CheckCircle2 className="q-callout-icon" aria-hidden />
            <div className="q-callout-copy">
              <p className="q-callout-title">{t('qualityShareCreated')}</p>
              <a className="q-share-url" href={shareUrl(created.slug)} target="_blank" rel="noreferrer">
                {shareUrl(created.slug)}
              </a>
            </div>
            <CopyButton value={shareUrl(created.slug)} variant="outline" />
          </div>
        ) : null}
        {shareMutation.error ? (
          <p className="q-form-error" role="alert">
            {(shareMutation.error as Error).message}
          </p>
        ) : null}

        {websiteId ? (
          <ShareManage websiteId={websiteId} onCreate={create} creating={shareMutation.isPending} highlightId={created?.id} />
        ) : null}

        <p className="q-view-only">{t('qualityShareNote')}</p>
      </PageBody>
    </Page>
  );
}
