import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { cn } from '../../lib/utils';

export type PageTab<T extends string> = { id: T; label: ReactNode; count?: number };

/**
 * Underline tabs for the views of one page (logs: explore / live tail / traces). A hairline runs
 * the full width under them; the active tab gets the gray-1000 bar. Panels render outside, so
 * pages keep their own conditional content.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: Array<PageTab<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className={cn('q-tabs', className)}>
      <TabsList variant="line" aria-label={label} className="q-tabs-list">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} className="q-tabs-trigger">
            {tab.label}
            {tab.count !== undefined ? <span className="q-tabs-count">{tab.count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
