import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ModalDialog } from './ModalDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

/**
 * Add a website (`website` null) or edit its name and domain. Creating calls `onCreated` with
 * the new site so the caller can open its tracking setup.
 */
export function WebsiteFormDialog({
  open,
  onClose,
  website,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  website: Website | null;
  onCreated?: (website: Website) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const creating = website === null;

  useEffect(() => {
    if (!open) return;
    setName(website?.name ?? '');
    setDomain(website?.domain ?? '');
  }, [open, website]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t('nameRequired'));
      const body = JSON.stringify({ name: trimmedName, domain: domain.trim() });
      if (!website) return api<Website>('/api/websites', { method: 'POST', body });
      return api<Website>(`/api/websites/${website.id}`, { method: 'PATCH', body });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] });
      if (website) {
        queryClient.invalidateQueries({ queryKey: ['website', website.id] });
        onClose();
      } else {
        onCreated?.(saved);
        onClose();
      }
    },
  });

  useEffect(() => {
    if (!open) saveMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const canSave = name.trim().length > 0 && !saveMutation.isPending;
  const title = creating ? t('addWebsite') : t('editWebsite');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSave) saveMutation.mutate();
  }

  return (
    <ModalDialog className="ws-dialog ws-dialog--sm" aria-label={title} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <header className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          {creating ? <p>{t('addWebsiteLead')}</p> : null}
        </header>

        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="website-dialog-name">{t('name')}</Label>
            <Input
              id="website-dialog-name"
              value={name}
              placeholder={creating ? t('mySite') : undefined}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <Label htmlFor="website-dialog-domain">{t('domain')}</Label>
            <Input
              id="website-dialog-domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          {saveMutation.error ? (
            <p className="text-danger" role="alert">
              {(saveMutation.error as Error).message}
            </p>
          ) : null}
        </div>

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {creating ? t('create') : t('save')}
          </Button>
        </footer>
      </form>
    </ModalDialog>
  );
}
