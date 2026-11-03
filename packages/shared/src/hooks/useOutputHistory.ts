import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getCompanyPacks } from '../services/companies';
import { getRegisterInspectionCopies } from '../services/company-tokens';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function inspectionCopiesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'inspection-copies', token];
}

export function companyPacksKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'company-packs', company];
}

export function useInspectionCopies(
  owner: OrderSubmissionOwner,
  token: string,
  guard: () => void,
  enabled: boolean,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: inspectionCopiesKey(owner, token),
    enabled,
    ...READ_TIMING,
    queryFn: async ({ signal }) => {
      guard();
      const { data } = await getRegisterInspectionCopies(apiClient, token, {
        ...session?.requestConfig(),
        signal,
        ledovaSubmissionGuard: guard,
      });
      guard();
      return data.copies;
    },
  });
}

export function useCompanyPacks(
  owner: OrderSubmissionOwner,
  company: string,
  guard: () => void,
  enabled: boolean,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: companyPacksKey(owner, company),
    enabled,
    ...READ_TIMING,
    queryFn: async ({ signal }) => {
      guard();
      const { data } = await getCompanyPacks(apiClient, company, {
        ...session?.requestConfig(),
        signal,
        ledovaSubmissionGuard: guard,
      });
      guard();
      return data.packs;
    },
  });
}
