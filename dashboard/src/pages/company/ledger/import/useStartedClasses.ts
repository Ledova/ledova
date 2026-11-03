import { useQuery } from '@tanstack/react-query';
import { getCompanyOwnership, type OrderSubmissionOwner, READ_TIMING, registerHoldersKey } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useStartedClasses<T extends { uuid: string }>(
  owner: OrderSubmissionOwner,
  guard: () => void,
  company: string,
  drafts: T[],
  enabled: boolean,
) {
  const ownership = useQuery({
    queryKey: [...registerHoldersKey(owner), 'setup', company, ...drafts.map(({ uuid }) => uuid)],
    enabled: enabled && drafts.length > 0,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyOwnership(apiClient, company, { ledovaSubmissionGuard: guard });
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
