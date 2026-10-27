import { useLocation } from 'react-router-dom';
import { MemberDocuments } from './MemberDocuments';
import { OwnershipBrowser } from './OwnershipBrowser';

export default function DashboardPage() {
  return useLocation().hash === '#documents' ? <MemberDocuments /> : <OwnershipBrowser />;
}
