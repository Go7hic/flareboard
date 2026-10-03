import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';

// Base UI's dialog is a chunk of its own: most pages (the marketing pages included) never confirm.
const ConfirmDialogView = lazy(() => import('./ConfirmDialogView'));

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
};

/** Shared confirmation for destructive actions (replaces window.confirm and one-click deletes). */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mounted from the first open on, so later opens and the exit animation need no reload.
  const [used, setUsed] = useState(props.open);
  if (props.open && !used) setUsed(true);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <ConfirmDialogView {...props} />
    </Suspense>
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
