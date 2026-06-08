import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../lib/i18n';

export function ExportMenu({
  onExport,
}: {
  onExport: (type: 'pageviews' | 'events') => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(type: 'pageviews' | 'events') {
    setOpen(false);
    onExport(type);
  }

  return (
    <div className={`export-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="export-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={listId}
      >
        <svg
          className="export-menu-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{t('export')}</span>
        <svg
          className="export-menu-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul id={listId} role="menu" className="export-menu-list" aria-label={t('export')}>
          <li role="none">
            <button type="button" role="menuitem" className="export-menu-option" onClick={() => pick('pageviews')}>
              {t('exportBrowsing')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className="export-menu-option" onClick={() => pick('events')}>
              {t('exportEventsOption')}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
