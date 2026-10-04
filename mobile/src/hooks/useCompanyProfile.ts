import { useCompanySelection } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { orderSubmissionSession } from '../services/orderSubmissions';
import { useCompanyAccess } from '../screens/company-register/useCompanyRegister';

export function useCompanyProfile({
  ownedOnly = false,
  personalOnly = false,
}: { ownedOnly?: boolean; personalOnly?: boolean } = {}) {
  const access = useCompanyAccess();
  const selection = useCompanySelection(apiClient, { ownedOnly, personalOnly, session: orderSubmissionSession });
  return { ...selection, access };
}
