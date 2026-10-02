import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

/**
 * Side sheet for the detail of a table row (person, group): Base UI dialog (focus trap,
 * Escape / outside press to close) anchored to the right edge, full height, own scroll.
 */
export function DetailSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name (the row's title). */
  label: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="dialog-backdrop audience-sheet-backdrop" />
        <DialogPrimitive.Popup className="audience-sheet" aria-label={label}>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Sticky sheet header: leading visual, title + subtitle, meta facts, close button. */
export function DetailSheetHeader({
  leading,
  title,
  subtitle,
  meta,
  actions,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="audience-sheet-head">
      <div className="audience-sheet-head-row">
        {leading}
        <div className="audience-sheet-head-copy">
          <DialogPrimitive.Title className="audience-sheet-title">{title}</DialogPrimitive.Title>
          {subtitle ? <p className="audience-sheet-subtitle">{subtitle}</p> : null}
        </div>
        <div className="audience-sheet-head-actions">
          {actions}
          <DialogPrimitive.Close
            render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t('close')} />}
          >
            <X aria-hidden />
          </DialogPrimitive.Close>
        </div>
      </div>
      {meta ? <div className="meta-line audience-sheet-meta">{meta}</div> : null}
    </header>
  );
}

/** A titled section of a sheet or detail pane, separated by a hairline (no box). */
export function DetailSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `audience-section ${className}` : 'audience-section'}>
      <div className="audience-section-head">
        <div className="audience-section-copy">
          <h3 className="audience-section-title">{title}</h3>
          {description ? <p className="audience-section-description">{description}</p> : null}
        </div>
        {actions ? <div className="audience-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Loading rows for a detail section, in the shape of its list. */
export function DetailSectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="audience-section-skeleton" aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}
