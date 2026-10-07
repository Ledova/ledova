import { useQuery } from '@tanstack/react-query';
import { failureStatus, getRegisterLinks, getRegisterWaitingWallets, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';
import { firstOfEach } from './useRegisterCorrections';

export function linksKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'links', company];
}

export function waitingWalletsKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'waiting-wallets', company];
}

export function useRegisterLinks(owner: OrderSubmissionOwner, company: string, guard: () => void) {
  return useQuery({
    queryKey: linksKey(owner, company),
    queryFn: async () => {
      guard();
      const links = await getRegisterLinks(apiClient, { company }, { ledovaSubmissionGuard: guard });
      guard();
      if (links.some((link) => link.company !== company))
        throw new Error('The wallet links did not identify this company.');
      return firstOfEach(links, ({ uuid }) => uuid).sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
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
