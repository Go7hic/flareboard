import type { ReactNode } from 'react';

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
  if (tabs.length <= 1) return null;

  const rootClass = [
    'segment-tabs',
    size === 'sm' ? 'segment-tabs--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
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
