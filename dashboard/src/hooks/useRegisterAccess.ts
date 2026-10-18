import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  canPersonallyAdministerCompany,
  getCompanies,
  getRegisterClasses,
  readEveryPage,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export const READ_TIMING = { staleTime: CACHE_TIMING.SHORT_STALE_TIME, gcTime: CACHE_TIMING.MEDIUM_GC_TIME };

export function registerKey(owner: OrderSubmissionOwner | null) {
  return ['tokens', 'register', owner?.userUuid, owner?.ownerAccountUuid];
}

export function useRegisterEntryAccess(enabled = true) {
  const { owner, boundary } = useSubmissionOwner();
  return useQuery({
    queryKey: [...registerKey(owner), 'access'],
    enabled: !!owner && enabled,
    queryFn: async () => {
      if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      const response = await getRegisterClasses(apiClient, { page: 1 });
      if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      if (response.data.results.length > 0) return true;
      const companies = await readEveryPage((page) => {
        if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
        return getCompanies(apiClient, page, {
          ledovaSubmissionGuard: () => {
            if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
          },
        });
      });
      if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      return companies.some(canPersonallyAdministerCompany);
    },
    ...READ_TIMING,
  });
}

export function useRegisterEntry() {
  const access = useRegisterEntryAccess();
  return access.isSuccess && !access.isFetching && access.data;
}
