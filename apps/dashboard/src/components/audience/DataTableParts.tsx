import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/skeleton';

export type SortDirection = 'asc' | 'desc';
export type SortState<K extends string> = { key: K; direction: SortDirection };

/** Next sort state when a header is clicked: new column → descending, same column → flip. */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, direction: 'desc' };
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}

/** A `<th>` whose label is a sort button (aria-sort on the cell, arrow on the active one). */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  numeric = false,
  className,
}: {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  numeric?: boolean;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn(numeric && 'num', className)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={cn('audience-sort', active && 'is-active', numeric && 'is-numeric')}
        onClick={() => onSort(nextSort(sort, sortKey))}
      >
        {label}
        {active ? <Arrow aria-hidden /> : null}
      </button>
    </th>
  );
}

/** Table body skeleton in the final shape: an avatar + two lines, then numeric cells. */
export function TableSkeletonRows({
  rows = 8,
  columns,
  hideOnPhone = [],
}: {
  rows?: number;
  columns: number;
  /** Column indexes (0 = identity) hidden on phones, matching the real rows. */
  hideOnPhone?: number[];
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden>
          <td>
            <div className="audience-identity">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="audience-identity-copy">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="mt-1.5 h-3 w-24" />
              </div>
            </div>
          </td>
          {Array.from({ length: columns - 1 }, (_, col) => (
            <td key={col} className={cn(col > 0 && 'num', hideOnPhone.includes(col + 1) && 'audience-hide-sm')}>
              <Skeleton className={cn('h-3.5', col === 0 ? 'w-28' : 'ml-auto w-10')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
