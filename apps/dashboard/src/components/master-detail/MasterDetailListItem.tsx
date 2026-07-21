import type { ReactNode } from 'react';

type MasterDetailListItemProps = {
  selected?: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
};

export function MasterDetailListItem({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  meta,
}: MasterDetailListItemProps) {
  return (
    <button
      type="button"
      className={`master-detail-list-item${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="master-detail-list-main">
        {icon}
        <span className="master-detail-list-copy">
          <span className="master-detail-list-title">{title}</span>
          {subtitle ? <span className="master-detail-list-subtitle">{subtitle}</span> : null}
        </span>
      </span>
      {meta ? <span className="master-detail-list-meta">{meta}</span> : null}
    </button>
  );
}
