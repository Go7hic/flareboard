import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

/** Shared confirmation for destructive actions (replaces window.confirm and one-click deletes). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = t('delete'),
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ConfirmOptions = {
  title: string;
  /** Defaults to "This cannot be undone." */
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

type ConfirmFn = (options: ConfirmOptions) => void;

const ConfirmContext = createContext<ConfirmFn>((options) => {
  if (window.confirm(options.title)) options.onConfirm();
});

/** Mount once near the root; `useConfirm()` then opens a single shared ConfirmDialog. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept after close so the title does not blank out during the exit animation.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setOptions(next);
    setOpen(true);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={options?.title ?? ''}
        description={options?.description ?? t('confirmDeleteBody')}
        confirmLabel={options?.confirmLabel}
        onConfirm={() => {
          setOpen(false);
          options?.onConfirm();
        }}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

/** `Delete “{name}”?` — the standard title for delete confirmations. */
export function deleteTitle(name: string | null | undefined) {
  return t('confirmDeleteTitle').replace('{name}', name || '');
}
