import { useQuery } from '@tanstack/react-query';
import {
  getRegisterAward,
  getRegisterAwards,
  getRegisterAwardVestings,
  hasValidRegisterAwardTotals,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export const awardsKey = (owner: OrderSubmissionOwner, token: string) => [...registerKey(owner), 'awards', token];
export const awardVestingsKey = (owner: OrderSubmissionOwner, award: string) => [
  ...registerKey(owner),
  'award-vestings',
  award,
];

export function useRegisterAwards(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
) {
  return useQuery({
    queryKey: awardsKey(owner, token),
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwards(apiClient, { company, token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.token !== token || !hasValidRegisterAwardTotals(row)))
        throw new Error('The awards do not belong to this class or have inconsistent quantities.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}

export function useRegisterAward(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  uuid: string,
  guard: () => void,
  enabled = true,
) {
  return useQuery({
    queryKey: [...awardsKey(owner, token), uuid],
    enabled: enabled && !!uuid && !!company,
    queryFn: async () => {
      guard();
      const { data } = await getRegisterAward(apiClient, uuid, { ledovaSubmissionGuard: guard });
      guard();
      if (data.uuid !== uuid || data.company !== company || data.token !== token || !hasValidRegisterAwardTotals(data))
        throw new Error('The award does not match this company and share class.');
      return data;
    },
    ...READ_TIMING,
  });
}

export function useRegisterAwardVestings(
  owner: OrderSubmissionOwner,
  company: string,
  award: string,
  guard: () => void,
) {
  return useQuery({
    queryKey: awardVestingsKey(owner, award),
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardVestings(
          apiClient,
          { company, award, page },
          { ledovaSubmissionGuard: guard },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.award !== award || !/^[1-9]\d*$/.test(row.shares)))
        throw new Error('The vesting events do not belong to this award.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}
