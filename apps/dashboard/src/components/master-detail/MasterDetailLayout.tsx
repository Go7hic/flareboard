import type { ReactNode } from 'react';

type MasterDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
  listClassName?: string;
  wrapList?: boolean;
};

export function MasterDetailLayout({
  list,
  detail,
  className,
  listClassName,
  wrapList = true,
}: MasterDetailLayoutProps) {
  const rootClass = className ?? 'master-detail-layout';
  const listNode = wrapList ? (
    <div className={['master-detail-list', listClassName].filter(Boolean).join(' ')}>{list}</div>
  ) : (
    list
  );

  return (
    <div className={rootClass}>
      {listNode}
      {detail}
    </div>
  );
}
