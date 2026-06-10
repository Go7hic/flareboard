import { Outlet } from 'react-router-dom';
import { WebsiteContentHeader } from './WebsiteContentHeader';

export function WebsiteShell() {
  return (
    <div className="website-layout">
      <WebsiteContentHeader />
      <Outlet />
    </div>
  );
}
