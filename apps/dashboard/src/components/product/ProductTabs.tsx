import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export type ProductTab<T extends string> = { id: T; label: ReactNode; content: ReactNode };

/**
 * Underline tabs for the sections of a detail card (spec §5: ui/tabs for detail sections).
 * The tab list runs edge to edge with a hairline under it; only the active panel renders.
 */
export function ProductTabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<ProductTab<T> | null | false>;
  label: string;
}) {
  const visible = tabs.filter(Boolean) as Array<ProductTab<T>>;
  const active = visible.some((tab) => tab.id === value) ? value : visible[0]?.id;
  return (
    <Tabs className="product-tabs" value={active} onValueChange={(next) => onChange(next as T)}>
      <TabsList variant="line" aria-label={label} className="product-tabs-list">
        {visible.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} className="product-tabs-trigger">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {visible.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="product-tab-panel">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
