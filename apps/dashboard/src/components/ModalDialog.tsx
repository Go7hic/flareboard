import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

/**
 * Shared modal for form dialogs: Base UI Dialog (portal, focus trap, scroll lock,
 * Escape / outside-press dismissal) wrapped around the legacy `.dialog-panel`
 * layout so `.dialog-header` / `.dialog-body` / `.dialog-footer` children keep working.
 */
export function ModalDialog({
  className,
  'aria-label': ariaLabel,
  role,
  onClose,
  children,
}: {
  /** Extra class(es) appended to `.dialog-panel`, e.g. "survey-dialog". */
  className?: string;
  'aria-label'?: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="dialog-backdrop" />
        <DialogPrimitive.Viewport className="dialog-viewport">
          <DialogPrimitive.Popup
            className={className ? `dialog-panel ${className}` : 'dialog-panel'}
            aria-label={ariaLabel}
            {...(role ? { role } : {})}
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
