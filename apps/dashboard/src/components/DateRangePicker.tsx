import { useEffect, useState } from 'react';
import { type DateRangePreset, presetToRange } from '../lib/dateRange';
import { t } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateRangePicker({
  value,
  onChange,
  compact = false,
}: {
  value: { preset: DateRangePreset; startAt: number; endAt: number };
  onChange: (next: { preset: DateRangePreset; startAt: number; endAt: number }) => void;
  compact?: boolean;
}) {
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customFocused, setCustomFocused] = useState(false);

  useEffect(() => {
    if (value.preset === 'custom') {
      setCustomStart(toDatetimeLocal(value.startAt));
      setCustomEnd(toDatetimeLocal(value.endAt));
    }
  }, [value.preset, value.startAt, value.endAt]);

  const isCustomActive = value.preset === 'custom' || detailsOpen || customFocused;

  function presetIsActive(preset: Exclude<DateRangePreset, 'custom'>) {
    return value.preset === preset && !isCustomActive;
  }

  function applyPreset(preset: DateRangePreset) {
    const { startAt, endAt } = presetToRange(preset, customStart, customEnd);
    onChange({ preset, startAt, endAt });
    if (preset !== 'custom') {
      setDetailsOpen(false);
      setCustomFocused(false);
    }
  }

  function prefillCustomFromValue() {
    if (value.preset !== 'custom') {
      setCustomStart(toDatetimeLocal(value.startAt));
      setCustomEnd(toDatetimeLocal(value.endAt));
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

  const showCustomControls = !compact || detailsOpen || value.preset === 'custom';

  const customControls = (
    <>
      <Input
        type="datetime-local"
        className="date-range-picker-input w-auto"
        value={customStart}
        onChange={(e) => setCustomStart(e.target.value)}
        onFocus={() => setCustomFocused(true)}
        onBlur={() => setCustomFocused(false)}
        aria-label={t('customStart')}
      />
      <span className="date-range-picker-sep" aria-hidden>
        —
      </span>
      <Input
        type="datetime-local"
        className="date-range-picker-input w-auto"
        value={customEnd}
        onChange={(e) => setCustomEnd(e.target.value)}
        onFocus={() => setCustomFocused(true)}
        onBlur={() => setCustomFocused(false)}
        aria-label={t('customEnd')}
      />
      <Button
        type="button"
        size="sm"
        variant={isCustomActive ? 'primary' : 'secondary'}
        className="date-range-picker-apply"
        onClick={() => applyPreset('custom')}
      >
        {compact ? t('applyRange') : t('customRange')}
      </Button>
    </>
  );

  return (
    <div
      className={`date-range-picker${compact ? ' date-range-picker--compact' : ''}`}
      role="group"
      aria-label={t('dateRange')}
    >
      {!compact ? <span className="date-range-picker-label">{t('dateRange')}</span> : null}
      <div className="date-range-picker-row">
        <div className="date-range-picker-presets">
          {(['24h', '7d', '30d', '90d'] as const).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={presetIsActive(p) ? 'primary' : 'secondary'}
              onClick={() => applyPreset(p)}
            >
              {p}
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
