import { useEffect, useId, useRef, useState } from 'react';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { formatDateTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';

const PRESET_ORDER = ['24h', '7d', '30d', '90d'] as const;

const PRESET_LABEL_KEYS: Record<(typeof PRESET_ORDER)[number], string> = {
  '24h': 'datePreset24h',
  '7d': 'datePreset7d',
  '30d': 'datePreset30d',
  '90d': 'datePreset90d',
};

function toDatetimeLocal(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function formatRangeLabel(startAt: number, endAt: number, timezone: string): string {
  const opts = { timeZone: timezone, includeYear: false as const };
  return `${formatDateTime(startAt, opts)} – ${formatDateTime(endAt, opts)}`;
}

function presetLabel(
  preset: DateRangePreset,
  startAt: number,
  endAt: number,
  timezone: string,
): string {
  if (preset === 'custom') return formatRangeLabel(startAt, endAt, timezone);
  return t(PRESET_LABEL_KEYS[preset]);
}

export function DateRangePicker({
  value,
  onChange,
  compact = false,
  popover = false,
  timezone = 'UTC',
}: {
  value: { preset: DateRangePreset; startAt: number; endAt: number };
  onChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  compact?: boolean;
  popover?: boolean;
  timezone?: string;
}) {
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customFocused, setCustomFocused] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (value.preset === 'custom') {
      setCustomStart(toDatetimeLocal(value.startAt, timezone));
      setCustomEnd(toDatetimeLocal(value.endAt, timezone));
    }
  }, [value.preset, value.startAt, value.endAt, timezone]);

  useEffect(() => {
    if (!popover || !popoverOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopoverOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popover, popoverOpen]);

  const isCustomActive = value.preset === 'custom' || detailsOpen || customFocused;

  function presetIsActive(preset: Exclude<DateRangePreset, 'custom'>) {
    return value.preset === preset && !isCustomActive;
  }

  function applyPreset(preset: DateRangePreset, closePopover = false) {
    const { startAt, endAt } = presetToRange(preset, customStart, customEnd, timezone);
    onChange({ preset, startAt, endAt });
    if (preset !== 'custom') {
      setDetailsOpen(false);
      setCustomFocused(false);
      if (closePopover) setPopoverOpen(false);
    }
  }

  function prefillCustomFromValue() {
    if (value.preset !== 'custom') {
      setCustomStart(toDatetimeLocal(value.startAt, timezone));
      setCustomEnd(toDatetimeLocal(value.endAt, timezone));
    }
  }

  function toggleCustomPanel() {
    if (detailsOpen) {
      setDetailsOpen(false);
      setCustomFocused(false);
      return;
    }
    prefillCustomFromValue();
    setDetailsOpen(true);
  }

  const showCustomControls = !compact || detailsOpen || value.preset === 'custom' || popover;

  const customControls = (
    <>
      <div className="date-range-picker-field">
        <span className="date-range-picker-field-label">{t('customStart')}</span>
        <Input
          type="datetime-local"
          className="date-range-picker-input"
          value={customStart}
          onChange={(e) => setCustomStart(e.target.value)}
          onFocus={() => setCustomFocused(true)}
          onBlur={() => setCustomFocused(false)}
          aria-label={t('customStart')}
        />
      </div>
      <div className="date-range-picker-field">
        <span className="date-range-picker-field-label">{t('customEnd')}</span>
        <Input
          type="datetime-local"
          className="date-range-picker-input"
          value={customEnd}
          onChange={(e) => setCustomEnd(e.target.value)}
          onFocus={() => setCustomFocused(true)}
          onBlur={() => setCustomFocused(false)}
          aria-label={t('customEnd')}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        className="date-range-picker-apply"
        onClick={() => applyPreset('custom', popover)}
      >
        {t('applyRange')}
      </Button>
    </>
  );

  if (popover) {
    return (
      <div
        className={`date-range-picker date-range-picker--popover${popoverOpen ? ' is-open' : ''}`}
        ref={rootRef}
      >
        <button
          type="button"
          className="date-range-picker-trigger"
          onClick={() => setPopoverOpen((v) => !v)}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          aria-controls={popoverId}
        >
          <svg
            className="date-range-picker-trigger-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="date-range-picker-trigger-label">
            {presetLabel(value.preset, value.startAt, value.endAt, timezone)}
          </span>
          <svg
            className="date-range-picker-trigger-chevron"
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
        {popoverOpen ? (
          <div id={popoverId} className="date-range-picker-popover" role="dialog" aria-label={t('dateRange')}>
            <div className="date-range-picker-popover-body">
              <div className="date-range-picker-popover-custom">{customControls}</div>
              <ul className="date-range-picker-popover-presets" aria-label={t('dateRange')}>
                {PRESET_ORDER.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={`date-range-picker-preset${value.preset === p ? ' is-active' : ''}`}
                      onClick={() => applyPreset(p, true)}
                    >
                      {t(PRESET_LABEL_KEYS[p])}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={`date-range-picker-preset${value.preset === 'custom' ? ' is-active' : ''}`}
                    onClick={() => {
                      prefillCustomFromValue();
                      setCustomFocused(true);
                    }}
                  >
                    {t('customRange')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`date-range-picker${compact ? ' date-range-picker--compact' : ''}`}
      role="group"
      aria-label={t('dateRange')}
    >
      {!compact ? <span className="date-range-picker-label">{t('dateRange')}</span> : null}
      <div className="date-range-picker-row">
        <div className="date-range-picker-presets">
          {PRESET_ORDER.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={presetIsActive(p) ? 'primary' : 'secondary'}
              onClick={() => applyPreset(p)}
            >
              {t(PRESET_LABEL_KEYS[p])}
            </Button>
          ))}
        </div>
        {compact ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={isCustomActive ? 'primary' : 'secondary'}
              className="date-range-picker-custom-trigger"
              onClick={toggleCustomPanel}
            >
              {t('customRange')}
            </Button>
            {showCustomControls ? (
              <div className="date-range-picker-custom">{customControls}</div>
            ) : null}
          </>
        ) : (
          <div className="date-range-picker-custom">{customControls}</div>
        )}
      </div>
    </div>
  );
}
