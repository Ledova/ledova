import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';

export default function CompanyPage() {
  const { hash, search, state } = useLocation();
  return (
    <Navigate
      to={
        hash === '#documents'
          ? { pathname: DESTINATIONS.companyDocuments.path, search }
          : { pathname: DESTINATIONS.settings.path, search, hash: '#profile' }
      }
      state={state}
      replace
    />
  );
}
