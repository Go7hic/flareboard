import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type SegmentedOption<T extends string> = { id: T; label: ReactNode; title?: string };

/**
 * 2–4 mutually exclusive view toggles (console v2 `.segmented`): a radio group with arrow-key
 * navigation, used for filters in a toolbar or a card header.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label': string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.id === value);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.id);
    rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={cn('segmented', className)}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? 'is-active' : undefined}
            title={option.title}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
