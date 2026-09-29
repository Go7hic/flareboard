import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ModalDialog } from './ModalDialog';
import { useConfirm } from './ConfirmDialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { api, type ShareLink } from '../lib/api';
import { formatDateTime } from '../lib/format';
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  async function copy(link: ShareLink) {
    try {
      await navigator.clipboard.writeText(shareUrl(link.slug));
      setCopiedId(link.id);
    } catch {
      setCopiedId(null);
    }
  }

  const links = sharesQuery.data ?? [];

  return (
    <ModalDialog className="share-links-dialog" aria-label={t('shareLinksTitle')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('shareLinksTitle')}</h2>
        <p className="text-muted">{t('shareLinksLead').replace('{name}', entityName)}</p>
      </header>
      <div className="dialog-body">
        {sharesQuery.isLoading ? <div className="skeleton" style={{ height: '2.5rem' }} /> : null}
        {!sharesQuery.isLoading && !links.length ? <p className="text-muted">{t('shareLinksEmpty')}</p> : null}
        {links.length ? (
          <ul className="list-plain share-links-list">
            {links.map((link) => {
              const expired = link.expiresAt != null && new Date(link.expiresAt).getTime() <= Date.now();
              return (
                <li key={link.id} className="share-links-row">
                  <div className="share-links-row-main">
                    <a href={shareUrl(link.slug)} target="_blank" rel="noreferrer" className="share-links-url">
                      {shareUrl(link.slug)}
                    </a>
                    <span className="text-muted share-links-meta">
                      {expired
                        ? t('shareExpired')
                        : link.expiresAt
                          ? t('shareLinksExpires').replace('{date}', formatDateTime(new Date(link.expiresAt).getTime()))
                          : t('shareLinksNoExpiry')}
                    </span>
                  </div>
                  <div className="share-links-row-actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => copy(link)}>
                      {copiedId === link.id ? t('shareCopied') : t('copyShareLink')}
                    </Button>
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
          <div className="share-links-create">
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
            <Button type="button" variant="secondary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {t('shareLinksCreate')}
            </Button>
          </div>
        ) : null}
        <p className="text-muted share-links-note">{t('shareLinksNote')}</p>
        {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </footer>
    </ModalDialog>
  );
}
