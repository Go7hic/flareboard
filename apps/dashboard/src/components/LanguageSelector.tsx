import { useEffect, useId, useRef, useState } from 'react';
import { getLocale, LOCALE_LABELS, LOCALES, setLocale, t, type Locale } from '../lib/i18n';

export function LanguageSelector() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = getLocale();

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

  function select(next: Locale) {
    setOpen(false);
    if (next === current) return;
    setLocale(next);
    window.location.reload();
  }

  return (
    <div className={`locale-selector${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="locale-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('language')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
      >
        <svg
          className="locale-selector-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="locale-selector-label">{LOCALE_LABELS[current]}</span>
        <svg
          className="locale-selector-chevron"
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
        <ul
          id={listId}
          role="listbox"
          className="locale-selector-menu"
          aria-label={t('language')}
        >
          {LOCALES.map((loc) => (
            <li key={loc} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={loc === current}
                className={`locale-selector-option${loc === current ? ' is-active' : ''}`}
                onClick={() => select(loc)}
              >
                {LOCALE_LABELS[loc]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
