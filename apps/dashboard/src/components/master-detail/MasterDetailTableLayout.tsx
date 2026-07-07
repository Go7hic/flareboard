import type { ReactNode } from 'react';

type MasterDetailTableLayoutProps = {
  primary: ReactNode;
  side: ReactNode;
  className?: string;
};

export function MasterDetailTableLayout({ primary, side, className }: MasterDetailTableLayoutProps) {
  return (
    <div className={['master-detail-layout--table', 'error-issues-layout', className].filter(Boolean).join(' ')}>
      {primary}
      {side}
    </div>
  );
}
