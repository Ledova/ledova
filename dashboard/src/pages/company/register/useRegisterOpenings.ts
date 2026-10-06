import { useQuery } from '@tanstack/react-query';
import {
  getRegisterOpeningHolders,
  getRegisterOpenings,
  hasWholeShares,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';
import { firstOfEach } from './useRegisterCorrections';

export function openingsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'openings', token];
}

export function openingHoldersKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'holders', 'opening', token];
}

export function useRegisterOpenings(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: openingsKey(owner, token),
    queryFn: async () => {
      const openings = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterOpenings(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (
        openings.some(
          (proposal) => proposal.token !== token || !hasWholeShares(proposal.boundarySummary?.holdings ?? []),
        )
      )
        throw new Error('The openings did not state exact holdings of this share class.');
      return firstOfEach(openings, ({ uuid }) => uuid).sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}

export async function readOpeningHolders(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterOpeningHolders(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!hasWholeShares(data.holdings)) throw new Error('The chain holdings did not state exact share counts.');
  return data;
}
