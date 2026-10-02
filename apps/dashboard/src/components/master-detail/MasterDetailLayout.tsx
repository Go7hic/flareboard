import type { ReactNode } from 'react';

type MasterDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
  listClassName?: string;
  wrapList?: boolean;
  /** Sticky top of the list card: search, filters, count (console v2). */
  listHeader?: ReactNode;
};

/**
 * Console v2 master–detail: a 20rem list card (hairline rows, sticky while the detail scrolls)
 * beside the detail card. Stacks under 1024px.
 */
export function MasterDetailLayout({
  list,
  detail,
  className,
  listClassName,
  wrapList = true,
  listHeader,
}: MasterDetailLayoutProps) {
  const rootClass = className ?? 'master-detail-layout';
  const listNode = wrapList ? (
    <div className={['master-detail-list', listClassName].filter(Boolean).join(' ')}>
      {listHeader ? <div className="master-detail-list-head">{listHeader}</div> : null}
      {list}
    </div>
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
