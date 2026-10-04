import { useCompanySelection } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { orderSubmissionSession } from '../services/orderSubmissions';
import { useCompanyAccess } from '../screens/company-register/useCompanyRegister';

export function useCompanyProfile({ ownedOnly = false }: { ownedOnly?: boolean } = {}) {
  const access = useCompanyAccess();
  const selection = useCompanySelection(apiClient, { ownedOnly, session: orderSubmissionSession });
  return { ...selection, access };
}
