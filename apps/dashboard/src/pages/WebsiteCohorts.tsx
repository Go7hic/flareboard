import { useParams } from 'react-router-dom';
import { CohortsPanel } from '../components/CohortsPanel';
import { Page } from '../components/Page';

export default function WebsiteCohortsPage() {
  const { websiteId } = useParams<{ websiteId: string }>();

  return <Page className="page-cohorts">{websiteId ? <CohortsPanel websiteId={websiteId} /> : null}</Page>;
}
