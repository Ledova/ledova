import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';

export default function CompanyPage() {
  const { search, state } = useLocation();
  return <Navigate to={{ pathname: DESTINATIONS.settings.path, search, hash: '#profile' }} state={state} replace />;
}
