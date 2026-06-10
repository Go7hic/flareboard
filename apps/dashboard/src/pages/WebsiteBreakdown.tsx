import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { isMetricTab } from '../lib/breakdown-dimensions';

export default function WebsiteBreakdownPage() {
  const { websiteId } = useParams<{ websiteId: string }>();
  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get('type');
  const explorer = typeParam && isMetricTab(typeParam) ? typeParam : 'path';

  if (!websiteId) return null;

  return <Navigate to={`/websites/${websiteId}?explorer=${encodeURIComponent(explorer)}`} replace />;
}
