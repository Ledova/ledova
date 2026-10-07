import { useQuery } from '@tanstack/react-query';
import {
  getRegisterTransfers,
  getRegisterTransferMembers,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export const transfersKey = (owner: OrderSubmissionOwner, token: string) => [...registerKey(owner), 'transfers', token];
export const transferMembersKey = (owner: OrderSubmissionOwner, token: string) => [
  ...registerKey(owner),
  'members',
  token,
];

export function useTransferMembers(owner: OrderSubmissionOwner, token: string, guard: () => void, enabled = true) {
  return useQuery({
    queryKey: transferMembersKey(owner, token),
    enabled,
    queryFn: async () => {
      guard();
      const { data } = await getRegisterTransferMembers(apiClient, token, { ledovaSubmissionGuard: guard });
      guard();
      if (
        data.members.some((member) => !/^\d+$/.test(member.currentShares)) ||
        new Set(data.members.map((member) => member.member)).size !== data.members.length
      )
        throw new Error('The member selector did not return exact distinct holdings.');
      return data.members;
    },
    ...READ_TIMING,
  });
}

export function useRegisterTransfers(owner: OrderSubmissionOwner, company: string, token: string, guard: () => void) {
  return useQuery({
    queryKey: transfersKey(owner, token),
    queryFn: async () => {
      const transfers = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterTransfers(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (transfers.some((transfer) => transfer.token !== token || transfer.company !== company))
        throw new Error('The transfers do not belong to this share class.');
      return transfers.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    ...READ_TIMING,
  });
}
