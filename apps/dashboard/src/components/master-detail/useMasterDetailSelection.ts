import { useMemo, useState } from 'react';

type UseMasterDetailSelectionOptions<TId> = {
  initialId?: TId | null;
  defaultToFirst?: boolean;
};

export function useMasterDetailSelection<TItem, TId>(
  items: TItem[],
  getId: (item: TItem) => TId,
  options: UseMasterDetailSelectionOptions<TId> = {},
) {
  const [selectedId, setSelectedId] = useState<TId | null>(options.initialId ?? null);

  const selectedItem = useMemo(() => {
    if (!items.length) return null;
    if (selectedId != null) {
      const match = items.find((item) => getId(item) === selectedId);
      if (match) return match;
    }
    if (options.defaultToFirst) return items[0];
    return null;
  }, [items, selectedId, getId, options.defaultToFirst]);

  return { selectedId, setSelectedId, selectedItem };
}
