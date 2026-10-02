import type { CSSProperties, ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { t } from '../../lib/i18n';

/**
 * Right-hand sheet for secondary work (source maps, alert rules, saved filters, log detail on
 * narrow screens). Not modal on purpose: delete confirmations (useConfirm) open their own dialog
 * on top, and a modal sheet would trap focus away from it or close on the click. The scrim is a
 * plain element that closes the sheet; Escape closes it too.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  footer,
  width = 560,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra buttons in the header, left of the close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Max width in px (the sheet is full width on phones). */
  width?: number;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
      <DialogPrimitive.Portal>
        <div className="q-sheet-scrim" aria-hidden onClick={() => onOpenChange(false)} />
        <DialogPrimitive.Popup className="q-sheet" style={{ '--q-sheet-width': `${width}px` } as CSSProperties}>
          <header className="q-sheet-head">
            <div className="q-sheet-head-copy">
              <DialogPrimitive.Title className="q-sheet-title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="q-sheet-description">{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            <div className="q-sheet-head-actions">
              {actions}
              <DialogPrimitive.Close render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t('close')} />}>
                <X aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </header>
          <div className="q-sheet-body">{children}</div>
          {footer ? <footer className="q-sheet-foot">{footer}</footer> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
