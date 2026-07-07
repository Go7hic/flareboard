import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export type SegmentTabItem = {
  id: string;
  label: ReactNode;
};

export function SegmentTabs({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'sm',
  className,
}: {
  tabs: SegmentTabItem[];
  value: string;
  onChange: (id: string) => void;
  'aria-label'?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tablistRef = useRef<HTMLDivElement>(null);

  if (tabs.length <= 1) return null;

  const rootClass = [
    'segment-tabs',
    size === 'sm' ? 'segment-tabs--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  function focusTab(index: number) {
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = tabs.findIndex((tab) => tab.id === value);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onChange(nextTab.id);
    focusTab(nextIndex);
  }

  return (
    <div
      ref={tablistRef}
      className={rootClass}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`segment-tab${active ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
