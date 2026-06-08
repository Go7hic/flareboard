import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../lib/i18n';

interface Segment {
  id: string;
  name: string;
}

export function SegmentFilterMenu({
  segmentId,
  onSegmentChange,
  segments,
  compareEnabled,
  onCompareChange,
}: {
  segmentId: string;
  onSegmentChange: (id: string) => void;
  segments: Segment[];
  compareEnabled: boolean;
  onCompareChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const activeSegment = segments.find((s) => s.id === segmentId);
  const triggerLabel = activeSegment?.name ?? t('allVisitors');

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

  function pick(id: string) {
    onSegmentChange(id);
    setOpen(false);
  }

  return (
    <div className={`segment-filter-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="segment-filter-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
      >
        <svg
          className="segment-filter-menu-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <span className="segment-filter-menu-label">{triggerLabel}</span>
        <svg
          className="segment-filter-menu-chevron"
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
        <div id={listId} className="segment-filter-menu-panel" role="listbox" aria-label={t('filterBySegment')}>
          <ul className="segment-filter-menu-list list-plain">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!segmentId}
                className={`segment-filter-menu-option${!segmentId ? ' is-active' : ''}`}
                onClick={() => pick('')}
              >
                {t('allVisitors')}
              </button>
            </li>
            {segments.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={segmentId === s.id}
                  className={`segment-filter-menu-option${segmentId === s.id ? ' is-active' : ''}`}
                  onClick={() => pick(s.id)}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          <label className="segment-filter-menu-compare">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => onCompareChange(e.target.checked)}
            />
            {t('compareMode')}
          </label>
        </div>
      ) : null}
    </div>
  );
}
