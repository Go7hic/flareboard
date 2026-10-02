import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { useConfirm } from './ConfirmDialog';
import { CopyButton } from './quality/CopyButton';
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
export function ProjectKeyField({ websiteId, hideLabel = false }: { websiteId: string; hideLabel?: boolean }) {
  const inputId = useId();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const keyQuery = useProjectKey(websiteId);
  const { canEdit: canRotate } = useWebsitePermissions(websiteId);

  const rotateMutation = useMutation({
    mutationFn: () => api<ProjectKey>(`/api/websites/${websiteId}/project-key/rotate`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(projectKeyQueryKey(websiteId), data);
    },
  });

  function rotate() {
    confirm({
      title: t('projectKeyRotateTitle'),
      description: t('projectKeyRotateBody'),
      confirmLabel: t('projectKeyRotate'),
      onConfirm: () => rotateMutation.mutate(),
    });
  }

  return (
    <div className="q-field">
      <Label htmlFor={inputId} className={hideLabel ? 'sr-only' : undefined}>
        {t('projectKey')}
      </Label>
      {keyQuery.isLoading ? <Skeleton className="h-10 w-full" /> : null}
      {keyQuery.error ? <p className="q-form-error">{(keyQuery.error as Error).message}</p> : null}
      {keyQuery.data ? (
        <div className="q-key-row">
          <Input
            id={inputId}
            readOnly
            value={keyQuery.data.key}
            className="q-key-input"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton value={keyQuery.data.key} variant="outline" size="default" />
          {canRotate ? (
            <Button type="button" variant="outline" disabled={rotateMutation.isPending} onClick={rotate}>
              <RefreshCw aria-hidden />
              {t('projectKeyRotate')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {rotateMutation.error ? <p className="q-form-error">{(rotateMutation.error as Error).message}</p> : null}
      <p className="q-field-hint">{t('projectKeyHint')}</p>
    </div>
  );
}
