import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';
import { COMPANY_DOCUMENTS_PATH } from '@utils/paths';

export default function CompanyPage() {
  const { hash, search, state } = useLocation();
  return (
    <Navigate
      to={
        hash === '#documents'
          ? { pathname: COMPANY_DOCUMENTS_PATH, search }
          : { pathname: DESTINATIONS.settings.path, search, hash: '#profile' }
      }
      state={state}
      replace
    />
  );
}
