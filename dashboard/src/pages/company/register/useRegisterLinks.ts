import { useQuery } from '@tanstack/react-query';
import { failureStatus, getRegisterWaitingWallets, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export function linksKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'links', company];
}

export function waitingWalletsKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'waiting-wallets', company];
}

export function useWaitingWallets(
  owner: OrderSubmissionOwner,
  company: string,
  guard: () => void,
  { enabled, onMissing }: { enabled: boolean; onMissing: () => void },
) {
  return useQuery({
    queryKey: waitingWalletsKey(owner, company),
    enabled,
    queryFn: async () => {
      try {
        guard();
        const { data } = await getRegisterWaitingWallets(apiClient, company, { ledovaSubmissionGuard: guard });
        guard();
        return data.wallets;
      } catch (failure) {
        if (failureStatus(failure) === 404) onMissing();
        throw failure;
      }
    },
    ...READ_TIMING,
  });
}
