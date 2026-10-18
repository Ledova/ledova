import { useCompanySelection } from '@ledova/shared';
import { orderSubmissionSession } from '../services/orderSubmissions';
import { useCompanyAccess } from './useCompanyRegister';

export function useCompanyProfile({
  ownedOnly = false,
  personalOnly = false,
}: { ownedOnly?: boolean; personalOnly?: boolean } = {}) {
  const access = useCompanyAccess();
  const selection = useCompanySelection({ ownedOnly, personalOnly, session: orderSubmissionSession });
  return { ...selection, access };
}
