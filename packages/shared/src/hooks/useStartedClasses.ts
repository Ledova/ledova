import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getCompanyOwnership } from '../services/company-tokens';
import { useApiClient } from './useApiClient';
import { registerHoldersKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useStartedClasses<T extends { uuid: string }>(
  owner: OrderSubmissionOwner,
  guard: () => void,
  company: string,
  drafts: T[],
  enabled: boolean,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const ownership = useQuery({
    queryKey: [...registerHoldersKey(owner), 'setup', company, ...drafts.map(({ uuid }) => uuid)],
    enabled: enabled && drafts.length > 0,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyOwnership(apiClient, company, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      return data;
    },
    ...READ_TIMING,
  });
  return drafts.filter(
    ({ uuid }) =>
      ownership.data?.company === company &&
      ownership.data.classes.some((row) => row.uuid === uuid && !row.initialized),
  );
}
