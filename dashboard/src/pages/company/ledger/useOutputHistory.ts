import { useQuery } from '@tanstack/react-query';
import { getCompanyPacks, getRegisterInspectionCopies, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { registerKey } from '@hooks/useRegisterAccess';

export function inspectionCopiesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'inspection-copies', token];
}

export function companyPacksKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'company-packs', company];
}

export function useInspectionCopies(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: inspectionCopiesKey(owner, token),
    queryFn: async ({ signal }) => {
      guard();
      const { data } = await getRegisterInspectionCopies(apiClient, token, { signal, ledovaSubmissionGuard: guard });
      guard();
      return data.copies;
    },
  });
}

export function useCompanyPacks(owner: OrderSubmissionOwner, company: string, guard: () => void) {
  return useQuery({
    queryKey: companyPacksKey(owner, company),
    queryFn: async ({ signal }) => {
      guard();
      const { data } = await getCompanyPacks(apiClient, company, { signal, ledovaSubmissionGuard: guard });
      guard();
      return data.packs;
    },
  });
}
