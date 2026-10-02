import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2, Upload } from 'lucide-react';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { EmptyState } from '../EmptyState';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';
import { api, API_URL, type ErrorSourceMap } from '../../lib/api';
import { t } from '../../lib/i18n';
import { CodeBlock } from './CodeBlock';
import { RelativeTime } from './RelativeTime';
import { SideSheet } from './SideSheet';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMPTY_DRAFT = { release: '', file: '', content: '' };

/** Uploaded source maps (filtered by the page's release filter) with upload and delete. */
export function ErrorSourceMapsSheet({
  websiteId,
  canEdit,
  release,
  open,
  onOpenChange,
}: {
  websiteId: string;
  canEdit: boolean;
  release: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'upload'>('list');
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const query = useQuery({
    queryKey: ['error-source-maps', websiteId, release],
    enabled: open && Boolean(websiteId),
    queryFn: () => {
      const params = release ? `?release=${encodeURIComponent(release)}` : '';
      return api<{ sourceMaps: ErrorSourceMap[] }>(`/api/websites/${websiteId}/errors/source-maps${params}`);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: () =>
      api<ErrorSourceMap>(`/api/websites/${websiteId}/errors/source-maps`, {
        method: 'POST',
        body: JSON.stringify({ release: draft.release.trim(), file: draft.file.trim(), content: draft.content }),
      }),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      setView('list');
      queryClient.invalidateQueries({ queryKey: ['error-source-maps', websiteId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/websites/${websiteId}/errors/source-maps/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-source-maps', websiteId] }),
  });

  const maps = query.data?.sourceMaps ?? [];
  const canUpload = Boolean(draft.release.trim() && draft.file.trim() && draft.content.trim());

  return (
    <SideSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setView('list');
      }}
      title={view === 'upload' ? t('errorSourceMapUpload') : t('errorSourceMaps')}
      description={t('errorSourceMapsLead')}
      actions={
        canEdit && view === 'list' ? (
          <Button type="button" size="sm" onClick={() => setView('upload')}>
            <Upload aria-hidden />
            {t('qualityUpload')}
          </Button>
        ) : null
      }
      footer={
        view === 'upload' ? (
          <>
            {uploadMutation.error ? (
              <p className="q-form-error" role="alert">
                {(uploadMutation.error as Error).message}
              </p>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setView('list')}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canUpload || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
            >
              {uploadMutation.isPending ? t('saving') : t('errorSourceMapUpload')}
            </Button>
          </>
        ) : null
      }
    >
      {view === 'upload' ? (
        <div className="q-form">
          <div className="q-form-row">
            <div className="q-field">
              <Label htmlFor="source-map-release">{t('errorSourceMapRelease')}</Label>
              <Input
                id="source-map-release"
                value={draft.release}
                placeholder="storefront@3.40.0"
                onChange={(event) => setDraft((prev) => ({ ...prev, release: event.target.value }))}
              />
            </div>
            <div className="q-field">
              <Label htmlFor="source-map-file">{t('errorSourceMapFile')}</Label>
              <Input
                id="source-map-file"
                className="font-mono"
                value={draft.file}
                placeholder="assets/app.js.map"
                onChange={(event) => setDraft((prev) => ({ ...prev, file: event.target.value }))}
              />
            </div>
          </div>
          <div className="q-field">
            <Label htmlFor="source-map-content">{t('errorSourceMapContent')}</Label>
            <Textarea
              id="source-map-content"
              className="q-textarea-code"
              rows={12}
              value={draft.content}
              spellCheck={false}
              placeholder='{"version":3,"sources":[…],"mappings":"…"}'
              onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
            />
          </div>
        </div>
      ) : (
        <>
          {release ? <p className="q-sheet-note">{t('qualityFilteredByRelease').replace('{release}', release)}</p> : null}
          {query.isLoading ? (
            <div className="q-list" aria-hidden>
              {[0, 1, 2].map((index) => (
                <div key={index} className="q-list-row">
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : maps.length ? (
            <ul className="q-list">
              {maps.map((item) => (
                <li key={item.id} className="q-list-row">
                  <div className="q-list-main">
                    <span className="q-list-title mono" title={item.file}>
                      {item.file}
                    </span>
                    <span className="meta-line">
                      <span>{item.release}</span>
                      <span className="num">{formatBytes(item.size)}</span>
                      <RelativeTime value={item.updatedAt ?? item.createdAt} />
                    </span>
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="sm"
                      disabled={deleteMutation.isPending}
                      onClick={() =>
                        confirm({
                          title: deleteTitle(`${item.release} · ${item.file}`),
                          onConfirm: () => deleteMutation.mutate(item.id),
                        })
                      }
                    >
                      {t('delete')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<FileCode2 />}
              title={t('noSourceMaps')}
              description={t('errorResolvedStackEmptyBody')}
            />
          )}

          <section className="q-sheet-section">
            <h3 className="q-sheet-section-title">{t('qualityUploadFromCi')}</h3>
            <p className="q-sheet-section-lead">{t('errorSourceMapCiHint')}</p>
            <CodeBlock code={`POST ${API_URL || ''}/api/websites/${websiteId}/errors/source-maps`} />
          </section>
        </>
      )}
    </SideSheet>
  );
}
