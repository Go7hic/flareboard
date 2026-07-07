import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Shared accessible modal: backdrop + dialog panel using the existing
 * `.dialog-backdrop` / `.dialog-panel` classes. Handles Escape-to-close,
 * backdrop click to close, and moves focus into the dialog on open
 * (restoring it on close).
 */
export function ModalDialog({
  className,
  'aria-label': ariaLabel,
  onClose,
  children,
}: {
  /** Extra class(es) appended to `.dialog-panel`, e.g. "survey-dialog". */
  className?: string;
  'aria-label': string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (firstField ?? panel)?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={className ? `dialog-panel ${className}` : 'dialog-panel'}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
