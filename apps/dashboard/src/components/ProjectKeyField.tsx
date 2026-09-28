import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { useConfirm } from './ConfirmDialog';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useWebsitePermissions } from '../lib/useWebsitePermissions';

export type ProjectKey = { key: string; createdAt: number; rotatedAt: number | null };

export function projectKeyQueryKey(websiteId: string) {
  return ['project-key', websiteId] as const;
}

/** The website's project key, shared by every view so a rotation updates them all. */
export function useProjectKey(websiteId: string) {
  return useQuery({
    queryKey: projectKeyQueryKey(websiteId),
    queryFn: () => api<ProjectKey>(`/api/websites/${websiteId}/project-key`),
    staleTime: 60_000,
  });
}

/** Read-only project key with copy and, for people who can edit the website, rotate. */
export function ProjectKeyField({ websiteId }: { websiteId: string }) {
  const inputId = useId();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const keyQuery = useProjectKey(websiteId);
  const { canEdit: canRotate } = useWebsitePermissions(websiteId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const rotateMutation = useMutation({
    mutationFn: () => api<ProjectKey>(`/api/websites/${websiteId}/project-key/rotate`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(projectKeyQueryKey(websiteId), data);
      setCopied(false);
    },
  });

  async function copy() {
    if (!keyQuery.data) return;
    try {
      await navigator.clipboard.writeText(keyQuery.data.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function rotate() {
    confirm({
      title: t('projectKeyRotateTitle'),
      description: t('projectKeyRotateBody'),
      confirmLabel: t('projectKeyRotate'),
      onConfirm: () => rotateMutation.mutate(),
    });
  }

  return (
    <div className="field">
      <Label htmlFor={inputId}>{t('projectKey')}</Label>
      {keyQuery.isLoading ? <Skeleton className="h-8 w-full" /> : null}
      {keyQuery.error ? <p className="text-danger">{(keyQuery.error as Error).message}</p> : null}
      {keyQuery.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={inputId}
            readOnly
            value={keyQuery.data.key}
            className="font-mono min-w-0 flex-1 basis-64"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="secondary" onClick={() => void copy()}>
            {copied ? t('copied') : t('copyToClipboard')}
          </Button>
          {canRotate ? (
            <Button type="button" variant="outline" disabled={rotateMutation.isPending} onClick={rotate}>
              {t('projectKeyRotate')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {rotateMutation.error ? <p className="text-danger">{(rotateMutation.error as Error).message}</p> : null}
      <p className="field-hint">{t('projectKeyHint')}</p>
    </div>
  );
}
