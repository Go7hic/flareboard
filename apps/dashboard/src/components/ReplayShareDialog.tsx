import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { useConfirm } from './ConfirmDialog';
import { Segmented } from './behavior/QueryCard';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Switch } from './ui/switch';
import { api } from '../lib/api';
import { formatDateTime, formatShortDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { formatPlayerTime, linkAtTime } from '../lib/replay-timeline';

export type ReplayShare = { id: string; visitId: string; token: string; expiresAt: number | null; createdAt: number };

type ExpiryOption = '' | '1' | '7' | '30';

const EXPIRY_OPTIONS: Array<{ value: ExpiryOption; label: string }> = [
  { value: '', label: 'replayShareNever' },
  { value: '1', label: 'replayShareExpires1d' },
  { value: '7', label: 'replayShareExpires7d' },
  { value: '30', label: 'replayShareExpires30d' },
];

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
  const [expiresIn, setExpiresIn] = useState<ExpiryOption>('');
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
    <ModalDialog className="behavior-share-dialog" aria-label={t('replayShareTitle')} onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">{t('replayShareTitle')}</h2>
        <p className="dialog-description">{t('replayShareLead')}</p>
      </header>
      <div className="dialog-body">
        {currentMs >= 1000 ? (
          <label className="behavior-share-at">
            <Switch size="sm" checked={atTime} onCheckedChange={(checked) => setAtTime(checked)} />
            {t('replayShareAtTime').replace('{time}', formatPlayerTime(currentMs))}
          </label>
        ) : null}

        <div className="behavior-share-section">
          <h3 className="behavior-share-heading">{t('behaviorShareLinks')}</h3>
          {sharesQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : shares.length ? (
            <ul className="behavior-share-list">
              {shares.map((share) => (
                <li key={share.id} className="behavior-share-item">
                  <div className="behavior-share-item-copy">
                    <span className="behavior-share-url" title={linkFor(share)}>
                      {linkFor(share).replace(/^https?:\/\//, '')}
                    </span>
                    <span className="behavior-share-meta">
                      <span title={formatDateTime(share.createdAt)}>
                        {t('replayShareCreated')} {formatShortDateTime(share.createdAt)}
                      </span>
                      <span>
                        {share.expiresAt
                          ? t('behaviorSharedExpires').replace('{date}', formatShortDateTime(share.expiresAt))
                          : t('replayShareNoExpiry')}
                      </span>
                    </span>
                  </div>
                  <div className="behavior-share-item-actions">
                    <Button type="button" variant="outline" size="sm" onClick={() => void copy(share)}>
                      <Copy aria-hidden />
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
          ) : (
            <p className="behavior-share-none">{t('replayShareNone')}</p>
          )}
        </div>

        {canEdit ? (
          <div className="behavior-share-section">
            <span className="behavior-share-heading">{t('replayShareExpiry')}</span>
            <Segmented
              value={expiresIn}
              onChange={setExpiresIn}
              label={t('replayShareExpiry')}
              options={EXPIRY_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
            />
          </div>
        ) : null}
        {createMutation.error ? (
          <p className="text-danger behavior-goal-dialog-error" role="alert">
            {(createMutation.error as Error).message}
          </p>
        ) : null}
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
