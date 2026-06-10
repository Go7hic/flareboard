import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { api, type Website } from '../lib/api';
import { t } from '../lib/i18n';

export function WebsiteFormDialog({
  open,
  onClose,
  website,
}: {
  open: boolean;
  onClose: () => void;
  website: Website | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  useEffect(() => {
    if (!open || !website) return;
    setName(website.name);
    setDomain(website.domain ?? '');
  }, [open, website]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!website) throw new Error(t('websiteNotFound'));
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t('nameRequired'));
      return api<Website>(`/api/websites/${website.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          domain: domain.trim(),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      if (website) {
        queryClient.invalidateQueries({ queryKey: ['website', website.id] });
      }
      onClose();
    },
  });

  if (!open || !website) return null;

  const canSave = name.trim().length > 0 && !saveMutation.isPending;

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-panel website-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('editWebsite')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">{t('editWebsite')}</h2>
        </header>

        <div className="dialog-body">
          <div className="field">
            <Label htmlFor="website-dialog-name">{t('name')}</Label>
            <Input
              id="website-dialog-name"
              value={name}
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
            <p className="text-danger">{(saveMutation.error as Error).message}</p>
          ) : null}
        </div>

        <footer className="dialog-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {t('save')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
