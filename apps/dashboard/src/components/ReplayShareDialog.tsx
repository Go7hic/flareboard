import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { useConfirm } from './ConfirmDialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { formatPlayerTime, linkAtTime } from '../lib/replay-timeline';

export type ReplayShare = { id: string; visitId: string; token: string; expiresAt: number | null; createdAt: number };

const EXPIRY_OPTIONS = [
  { value: '', label: 'replayShareNever' },
  { value: '1', label: 'replayShareExpires1d' },
  { value: '7', label: 'replayShareExpires7d' },
  { value: '30', label: 'replayShareExpires30d' },
] as const;

export function sharedReplayUrl(token: string) {
  return `${window.location.origin}/shared/replay/${token}`;
}

/** Public links to one replay: create (optional expiry), copy (optionally at the playhead), revoke. */
export function ReplayShareDialog({
  websiteId,
  visitId,
  currentMs,
  canEdit,
  onClose,
}: {
  websiteId: string;
  visitId: string;
  currentMs: number;
  canEdit: boolean;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [expiresIn, setExpiresIn] = useState('');
  const [atTime, setAtTime] = useState(currentMs >= 1000);
  const [copied, setCopied] = useState<string | null>(null);
  const queryKey = ['replay-shares', websiteId, visitId];

  const sharesQuery = useQuery({
    queryKey,
    queryFn: () => api<ReplayShare[]>(`/api/websites/${websiteId}/replays/${visitId}/shares`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api<ReplayShare>(`/api/websites/${websiteId}/replays/${visitId}/shares`, {
        method: 'POST',
        body: JSON.stringify({ expiresInDays: expiresIn ? Number(expiresIn) : null }),
      }),
    onSuccess: async (share) => {
      await queryClient.invalidateQueries({ queryKey });
      await copy(share);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) =>
      api(`/api/websites/${websiteId}/replays/shares/${shareId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function linkFor(share: ReplayShare) {
    const base = sharedReplayUrl(share.token);
    return atTime ? linkAtTime(base, currentMs) : base;
  }

  async function copy(share: ReplayShare) {
    try {
      await navigator.clipboard.writeText(linkFor(share));
      setCopied(share.id);
    } catch {
      setCopied(null);
    }
  }

  const shares = sharesQuery.data ?? [];

  return (
    <ModalDialog className="replay-share-dialog" aria-label={t('replayShareTitle')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('replayShareTitle')}</h2>
      </header>
      <div className="dialog-body">
        <p className="field-hint">{t('replayShareLead')}</p>
        <label className="field field-inline">
          <input type="checkbox" checked={atTime} onChange={(event) => setAtTime(event.target.checked)} />
          {t('replayShareAtTime').replace('{time}', formatPlayerTime(currentMs))}
        </label>
        {sharesQuery.isLoading ? <Skeleton className="h-6 w-1/2" /> : null}
        {shares.length ? (
          <ul className="replay-share-list">
            {shares.map((share) => (
              <li key={share.id} className="replay-share-item">
                <div className="min-w-0">
                  <div className="replay-share-url">{linkFor(share)}</div>
                  <div className="field-hint">
                    {t('replayShareCreated')} {formatDateTime(share.createdAt)} ·{' '}
                    {share.expiresAt ? `${t('replayShareExpiresAt')} ${formatDateTime(share.expiresAt)}` : t('replayShareNoExpiry')}
                  </div>
                </div>
                <div className="replay-share-item-actions">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copy(share)}>
                    {copied === share.id ? t('copied') : t('replayShareCopy')}
                  </Button>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="sm"
                      disabled={revokeMutation.isPending}
                      onClick={() =>
                        confirm({
                          title: t('replayShareRevokeTitle'),
                          description: t('replayShareRevokeBody'),
                          confirmLabel: t('replayShareRevoke'),
                          onConfirm: () => revokeMutation.mutate(share.id),
                        })
                      }
                    >
                      {t('replayShareRevoke')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : !sharesQuery.isLoading ? (
          <p className="text-muted">{t('replayShareNone')}</p>
        ) : null}
        {canEdit ? (
          <div className="field">
            <Label htmlFor="replay-share-expiry">{t('replayShareExpiry')}</Label>
            <select
              id="replay-share-expiry"
              className="select"
              value={expiresIn}
              onChange={(event) => setExpiresIn(event.target.value)}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {createMutation.error ? <p className="text-danger">{(createMutation.error as Error).message}</p> : null}
      </div>
      <footer className="dialog-footer">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        {canEdit ? (
          <Button type="button" variant="primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {t('replayShareCreate')}
          </Button>
        ) : null}
      </footer>
    </ModalDialog>
  );
}
