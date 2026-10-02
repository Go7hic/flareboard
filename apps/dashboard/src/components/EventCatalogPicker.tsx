import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api, type EventCatalogResponse } from '../lib/api';
import { t } from '../lib/i18n';
import { formatNumber } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';

type BaseProps = {
  websiteId: string | undefined;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
};

type SingleProps = BaseProps & {
  mode: 'single';
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
};

type MultiProps = BaseProps & {
  mode: 'multi';
  value: string[];
  onChange: (value: string[]) => void;
};

export type EventCatalogPickerProps = SingleProps | MultiProps;

function useEventCatalog(websiteId: string | undefined, search: string) {
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  return useQuery({
    queryKey: ['event-catalog', websiteId, debouncedSearch],
    enabled: Boolean(websiteId),
    queryFn: () =>
      api<EventCatalogResponse>(
        `/api/websites/${websiteId}/events/catalog${debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });
}

/**
 * The suggestion list, portaled to <body> and fixed under (or above) its input so dialogs and
 * cards with `overflow: auto` cannot clip it. Sits on the popover layer (z 310).
 */
function FloatingDropdown({
  anchorRef,
  floatingRef,
  id,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLDivElement | null>;
  id: string;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const openUp = below < 220 && rect.top > below;
      setStyle({
        left: rect.left,
        width: rect.width,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

  if (!style) return null;
  return createPortal(
    <div id={id} ref={floatingRef} className="event-catalog-picker-dropdown is-floating" style={style}>
      {children}
    </div>,
    document.body,
  );
}

function EventCatalogList({
  websiteId,
  search,
  onPick,
  exclude,
}: {
  websiteId: string | undefined;
  search: string;
  onPick: (eventName: string) => void;
  exclude?: Set<string>;
}) {
  const catalogQuery = useEventCatalog(websiteId, search);
  const events = (catalogQuery.data?.events ?? []).filter((event) => !exclude?.has(event.eventName));
  const trimmed = search.trim();
  const showCustom =
    trimmed.length > 0 && !events.some((event) => event.eventName.toLowerCase() === trimmed.toLowerCase());

  if (catalogQuery.isLoading) {
    return <p className="event-catalog-picker-hint text-muted">{t('loading')}</p>;
  }

  if (!events.length && !showCustom) {
    return <p className="event-catalog-picker-hint text-muted">{t('eventCatalogEmptyTitle')}</p>;
  }

  return (
    <ul className="event-catalog-picker-list" role="listbox">
      {events.map((event) => (
        <li key={event.eventName}>
          <button
            type="button"
            className="event-catalog-picker-option"
            role="option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(event.eventName)}
          >
            <span className="event-catalog-picker-option-name">{event.eventName}</span>
            <span className="event-catalog-picker-option-meta text-muted">
              {formatNumber(event.events)} {t('events')}
            </span>
          </button>
        </li>
      ))}
      {showCustom ? (
        <li>
          <button
            type="button"
            className="event-catalog-picker-option event-catalog-picker-option-custom"
            role="option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(trimmed)}
          >
            {t('eventCatalogPickerUseCustom').replace('{name}', trimmed)}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function EventCatalogCombobox({
  websiteId,
  value,
  onChange,
  placeholder,
  id,
  'aria-label': ariaLabel,
  exclude,
  allowEmpty = false,
}: {
  websiteId: string | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  exclude?: Set<string>;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const isInside = (node: Node | null) =>
    Boolean(node && (rootRef.current?.contains(node) || floatingRef.current?.contains(node)));

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!isInside(event.target as Node)) {
        commitDraft();
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDraft(value);
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, value]);

  function commitDraft() {
    const next = draft.trim();
    if (!next && !allowEmpty) return;
    if (next !== value) onChange(next);
  }

  function pick(eventName: string) {
    setDraft(eventName);
    onChange(eventName);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="event-catalog-picker-combobox">
      <div className="event-catalog-picker-input-wrap">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
              setOpen(false);
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (!isInside(document.activeElement)) {
                commitDraft();
                setOpen(false);
              }
            }, 0);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="event-catalog-picker-toggle"
          aria-label={t('eventCatalogSearchPlaceholder')}
          onClick={() => setOpen((prev) => !prev)}
        >
          <ChevronDown size={16} strokeWidth={2} aria-hidden />
        </Button>
      </div>
      {open ? (
        <FloatingDropdown anchorRef={rootRef} floatingRef={floatingRef} id={listId}>
          <EventCatalogList websiteId={websiteId} search={draft} onPick={pick} exclude={exclude} />
        </FloatingDropdown>
      ) : null}
    </div>
  );
}

function EventCatalogSinglePicker({
  websiteId,
  value,
  onChange,
  placeholder,
  id,
  'aria-label': ariaLabel,
  allowEmpty,
  className,
}: Omit<SingleProps, 'mode'>) {
  return (
    <div className={['event-catalog-picker', className].filter(Boolean).join(' ')}>
      <EventCatalogCombobox
        websiteId={websiteId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        id={id}
        aria-label={ariaLabel}
        allowEmpty={allowEmpty}
      />
    </div>
  );
}

function EventCatalogMultiPicker({
  websiteId,
  value,
  onChange,
  placeholder,
  id,
  'aria-label': ariaLabel,
  className,
}: Omit<MultiProps, 'mode'>) {
  const exclude = new Set(value);
  const [stepDraft, setStepDraft] = useState('');
  const [stepOpen, setStepOpen] = useState(false);
  const stepRootRef = useRef<HTMLDivElement>(null);
  const stepFloatingRef = useRef<HTMLDivElement>(null);
  const stepListId = useId();

  useEffect(() => {
    if (!stepOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!stepRootRef.current?.contains(target) && !stepFloatingRef.current?.contains(target)) {
        setStepOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setStepOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [stepOpen]);

  function addStep(eventName: string) {
    const next = eventName.trim();
    if (!next || exclude.has(next)) return;
    onChange([...value, next]);
    setStepDraft('');
    setStepOpen(false);
  }

  function removeStep(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className={['event-catalog-picker', 'event-catalog-picker-multi', className].filter(Boolean).join(' ')}>
      {value.length ? (
        <ol className="event-catalog-picker-steps" aria-label={ariaLabel}>
          {value.map((step, index) => (
            <li key={`${step}-${index}`} className="event-catalog-picker-step">
              <span className="event-catalog-picker-step-index">{index + 1}</span>
              <span className="event-catalog-picker-step-name">{step}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('eventCatalogPickerRemoveStep').replace('{name}', step)}
                onClick={() => removeStep(index)}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <div ref={stepRootRef} className="event-catalog-picker-combobox">
        <div className="event-catalog-picker-input-wrap">
          <Input
            id={id}
            value={stepDraft}
            placeholder={placeholder ?? t('eventCatalogPickerAddStep')}
            aria-label={ariaLabel ?? t('eventCatalogPickerAddStep')}
            aria-expanded={stepOpen}
            aria-controls={stepListId}
            aria-autocomplete="list"
            role="combobox"
            onFocus={() => setStepOpen(true)}
            onChange={(event) => {
              setStepDraft(event.target.value);
              setStepOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addStep(stepDraft);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="event-catalog-picker-toggle"
            aria-label={t('eventCatalogSearchPlaceholder')}
            onClick={() => setStepOpen((prev) => !prev)}
          >
            <ChevronDown size={16} strokeWidth={2} aria-hidden />
          </Button>
        </div>
        {stepOpen ? (
          <FloatingDropdown anchorRef={stepRootRef} floatingRef={stepFloatingRef} id={stepListId}>
            <EventCatalogList
              websiteId={websiteId}
              search={stepDraft}
              onPick={addStep}
              exclude={exclude}
            />
          </FloatingDropdown>
        ) : null}
      </div>
    </div>
  );
}

export function EventCatalogPicker(props: EventCatalogPickerProps) {
  if (props.mode === 'single') {
    return <EventCatalogSinglePicker {...props} />;
  }
  return <EventCatalogMultiPicker {...props} />;
}
