import type { HTMLAttributes, ReactNode } from 'react';

type MasterDetailSelectableItemProps = {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  selectedClassName?: string;
  as?: 'button' | 'li';
} & Pick<HTMLAttributes<HTMLElement>, 'role' | 'tabIndex'>;

export function MasterDetailSelectableItem({
  selected,
  onSelect,
  children,
  className = 'master-detail-selectable-item',
  selectedClassName = 'is-selected',
  as = 'button',
  role,
  tabIndex,
}: MasterDetailSelectableItemProps) {
  const itemClass = `${className}${selected ? ` ${selectedClassName}` : ''}`;

  if (as === 'li') {
    return (
      <li className={itemClass} onClick={onSelect} role={role} tabIndex={tabIndex}>
        {children}
      </li>
    );
  }

  return (
    <button type="button" role={role} tabIndex={tabIndex} className={itemClass} onClick={onSelect}>
      {children}
    </button>
  );
}
