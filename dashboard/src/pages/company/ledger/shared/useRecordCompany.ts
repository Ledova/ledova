import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useRecordCompany(company: string | undefined, guard: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('company');
  useEffect(() => {
    if (!company || requested !== null) return;
    try {
      guard();
    } catch {
      return;
    }
    const search = new URLSearchParams(location.search);
    search.set('company', company);
    void navigate(
      { pathname: location.pathname, search: search.toString(), hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [company, requested, guard, location, navigate]);
  return !company || requested === null || requested === company;
}
