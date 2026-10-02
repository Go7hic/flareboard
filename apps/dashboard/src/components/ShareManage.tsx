import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { EmptyState } from './EmptyState';
import { SectionCard } from './SectionCard';
import { useConfirm } from './ConfirmDialog';
import { CopyButton } from './quality/CopyButton';
import { RelativeTime } from './quality/RelativeTime';
import { TableSkeleton } from './quality/TableSkeleton';
import { api, type ShareLink } from '../lib/api';
import { formatNumber, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

export function shareUrl(slug: string) {
  return `${window.location.origin}/share/${slug}`;
}

/**
 * The website's public share links as one list card: name, URL (copy / open), age and expiry,
 * revoke. `highlightId` marks a link that was just created.
 */
export function ShareManage({
  websiteId,
  onCreate,
  creating = false,
  highlightId,
}: {
  websiteId: string;
  onCreate?: () => void;
  creating?: boolean;
  highlightId?: string | null;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const sharesQuery = useQuery({
    queryKey: ['shares'],
    queryFn: () => api<ShareLink[]>('/api/share'),
  });

  const shares = (sharesQuery.data ?? []).filter((s) => s.entityId === websiteId);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/share/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shares'] }),
  });

  const revokingId =
    deleteMutation.isPending && typeof deleteMutation.variables === 'string' ? deleteMutation.variables : null;

  return (
    <SectionCard
      flush
      title={t('shareLinks')}
      description={t('qualityShareListLead')}
      actions={shares.length ? <span className="q-card-count">{formatNumber(shares.length)}</span> : null}
    >
      {sharesQuery.isLoading ? (
        <TableSkeleton rows={2} columns={3} />
      ) : !shares.length ? (
        <EmptyState
          icon={<Link2 />}
          title={t('qualityShareEmptyTitle')}
          description={t('sharePageLead')}
          action={
            onCreate ? (
              <Button type="button" size="sm" disabled={creating} onClick={onCreate}>
                <Plus aria-hidden />
                {t('createShareLink')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="q-share-list">
          {shares.map((s) => {
            const url = shareUrl(s.slug);
            return (
              <li key={s.id} className={cn('q-share-row', s.id === highlightId && 'is-new')}>
                <span className="q-share-icon" aria-hidden>
                  <Link2 />
                </span>
                <div className="q-list-main">
                  <span className="q-list-title">{s.name}</span>
                  <a className="q-share-url" href={url} target="_blank" rel="noreferrer" title={url}>
                    {url}
                  </a>
                </div>
                <div className="q-share-meta">
                  {s.createdAt ? (
                    <span>
                      {t('created')} <RelativeTime value={s.createdAt} />
                    </span>
                  ) : null}
                  <span>
                    {s.expiresAt
                      ? t('shareLinksExpires').replace('{date}', formatShortDate(s.expiresAt))
                      : t('shareLinksNoExpiry')}
                  </span>
                </div>
                <div className="q-list-actions">
                  <CopyButton value={url} iconOnly />
                  <Button asChild variant="ghost" size="icon-sm" aria-label={t('qualityOpenLink')} title={t('qualityOpenLink')}>
                    <a href={url} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden />
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    size="sm"
                    disabled={revokingId === s.id}
                    onClick={() =>
                      confirm({
                        title: t('revokeShareConfirmTitle').replace('{name}', s.name),
                        description: t('revokeShareConfirmBody'),
                        confirmLabel: t('revokeShareLink'),
                        onConfirm: () => deleteMutation.mutate(s.id),
                      })
                    }
                  >
                    {revokingId === s.id ? t('revokingShareLink') : t('revokeShareLink')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {deleteMutation.error ? (
        <p className="q-inline-alert q-inline-alert--danger" role="alert">
          {(deleteMutation.error as Error).message}
        </p>
      ) : null}
    </SectionCard>
  );
}
