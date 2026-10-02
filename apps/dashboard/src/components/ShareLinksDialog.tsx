import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus } from 'lucide-react';
import { ModalDialog } from './ModalDialog';
import { useConfirm } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { CopyButton } from './workspace/CopyButton';
import { api, type ShareLink } from '../lib/api';
import { formatDateTime, formatShortDate } from '../lib/format';
import { t } from '../lib/i18n';

const EXPIRY_OPTIONS = ['never', '7', '30', '90'] as const;

function shareUrl(slug: string) {
  return `${window.location.origin}/share/${slug}`;
}

/** Public read-only links of a board or an insight: create (optional expiry), copy, revoke. */
export function ShareLinksDialog({
  entityType,
  entityId,
  entityName,
  canEdit,
  onClose,
}: {
  entityType: 'board' | 'insight';
  entityId: string;
  entityName: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]>('30');
  const queryKey = ['share-links', entityId];

  const sharesQuery = useQuery({
    queryKey,
    queryFn: () => api<ShareLink[]>(`/api/share?entityId=${entityId}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<ShareLink>(`/api/${entityType === 'board' ? 'boards' : 'insights'}/${entityId}/share`, {
        method: 'POST',
        body: JSON.stringify(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/api/share/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const links = sharesQuery.data ?? [];

  return (
    <ModalDialog className="ws-dialog--md" aria-label={t('shareLinksTitle')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('shareLinksTitle')}</h2>
        <p>{t('shareLinksLead').replace('{name}', entityName)}</p>
      </header>
      <div className="dialog-body">
        {sharesQuery.isLoading ? <Skeleton className="h-11 w-full" /> : null}
        {!sharesQuery.isLoading && !links.length ? (
          <EmptyState icon={<Link2 />} title={t('shareLinksEmpty')} />
        ) : null}
        {links.length ? (
          <ul className="ws-dialog-list">
            {links.map((link) => {
              const expiresAt = link.expiresAt != null ? new Date(link.expiresAt).getTime() : null;
              const expired = expiresAt != null && expiresAt <= Date.now();
              const url = shareUrl(link.slug);
              return (
                <li key={link.id} className="ws-dialog-row">
                  <div className="ws-dialog-row-main">
                    <a href={url} target="_blank" rel="noreferrer" className="ws-share-url" title={url}>
                      {url.replace(/^https?:\/\//, '')}
                    </a>
                    <span className="ws-dialog-row-meta">
                      {expired ? (
                        <StatusBadge tone="warning">{t('shareExpired')}</StatusBadge>
                      ) : expiresAt != null ? (
                        <span title={formatDateTime(expiresAt)}>
                          {t('shareLinksExpires').replace('{date}', formatShortDate(expiresAt))}
                        </span>
                      ) : (
                        t('shareLinksNoExpiry')
                      )}
                    </span>
                  </div>
                  <div className="ws-dialog-row-actions">
                    <CopyButton text={url} label={t('copyShareLink')} copiedLabel={t('shareCopied')} iconOnly />
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        disabled={revokeMutation.isPending}
                        onClick={() =>
                          confirm({
                            title: t('shareLinksRevokeTitle'),
                            description: t('shareLinksRevokeBody'),
                            confirmLabel: t('shareLinksRevoke'),
                            onConfirm: () => revokeMutation.mutate(link.id),
                          })
                        }
                      >
                        {t('shareLinksRevoke')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {canEdit ? (
          <div className="ws-dialog-create">
            <div className="field">
              <Label htmlFor="share-link-expiry">{t('shareLinksExpiry')}</Label>
              <select
                id="share-link-expiry"
                className="select"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as (typeof EXPIRY_OPTIONS)[number])}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'never' ? t('shareLinksNoExpiry') : t('shareLinksExpiresIn').replace('{days}', option)}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              <Plus aria-hidden />
              {t('shareLinksCreate')}
            </Button>
          </div>
        ) : null}
        <p className="field-hint">{t('shareLinksNote')}</p>
        {createMutation.error ? (
          <p className="text-danger" role="alert">
            {(createMutation.error as Error).message}
          </p>
        ) : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
