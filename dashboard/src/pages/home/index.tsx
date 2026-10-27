import { Navigate, useLocation } from 'react-router-dom';
import { certificatesLocation } from '@utils/paths';
import { OwnershipBrowser } from './OwnershipBrowser';

export default function DashboardPage() {
  const location = useLocation();
  return location.hash === '#documents' ? (
    <Navigate to={certificatesLocation(location)} state={location.state} replace />
  ) : (
    <OwnershipBrowser />
  );
}
