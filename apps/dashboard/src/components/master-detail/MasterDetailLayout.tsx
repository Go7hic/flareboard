import type { ReactNode } from 'react';

type MasterDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
};

export function MasterDetailLayout({ list, detail, className }: MasterDetailLayoutProps) {
  return (
    <div className={['master-detail-layout', className].filter(Boolean).join(' ')}>
      <div className="master-detail-list">{list}</div>
      {detail}
    </div>
  );
}
