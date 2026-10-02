import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type KvItem = { label: ReactNode; value: ReactNode; key?: string };

/** Label / value pairs on hairline rows (console v2) instead of boxed stat tiles in detail panes. */
export function KvList({ items, compact = false, className }: { items: KvItem[]; compact?: boolean; className?: string }) {
  return (
    <dl className={cn('kv-list', compact && 'kv-list--compact', className)}>
      {items.map((item, index) => (
        <KvRow key={item.key ?? index} label={item.label} value={item.value} />
      ))}
    </dl>
  );
}

function KvRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
