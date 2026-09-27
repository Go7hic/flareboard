import { Outlet, useParams } from 'react-router-dom';
import { WebsiteContentHeader } from './WebsiteContentHeader';

export function WebsiteShell() {
  const { websiteId } = useParams();
  return (
    <div className="website-layout">
      <WebsiteContentHeader />
      {/* Remount per site so page state (forms, filters, selections) never carries across. */}
      <Outlet key={websiteId} />
    </div>
  );
}
