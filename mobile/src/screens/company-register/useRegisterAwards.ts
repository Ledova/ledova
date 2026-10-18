import { useQuery } from '@tanstack/react-query';
import {
  getRegisterAward,
  getRegisterAwards,
  getRegisterAwardVestings,
  getRegisterAwardEnds,
  getRegisterAwardVestingReversals,
  hasValidRegisterAwardTotals,
  hasValidRegisterAwardEnd,
  hasValidRegisterAwardVestingReversal,
  readEveryPage,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { registerKey } from '../../hooks/useCompanyRegister';

export const awardsKey = (epoch: number, token: string) => [...registerKey(epoch), 'awards', token];
export const awardVestingsKey = (epoch: number, award: string) => [...registerKey(epoch), 'award-vestings', award];

export function useRegisterAwards(epoch: number, company: string, token: string, guard: () => void, enabled: boolean) {
  return useQuery({
    queryKey: awardsKey(epoch, token),
    enabled,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwards(
          apiClient,
          { company, token, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard, signal },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.token !== token || !hasValidRegisterAwardTotals(row)))
        throw new Error('The awards do not belong to this class or have inconsistent quantities.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
  });
}

export function useRegisterAward(
  epoch: number,
  company: string,
  token: string,
  uuid: string,
  guard: () => void,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...awardsKey(epoch, token), uuid],
    enabled: enabled && !!uuid,
    queryFn: async ({ signal }) => {
      guard();
      const { data } = await getRegisterAward(apiClient, uuid, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
        signal,
      });
      guard();
      if (data.uuid !== uuid || data.company !== company || data.token !== token || !hasValidRegisterAwardTotals(data))
        throw new Error('The award does not match this company and share class.');
      return data;
    },
  });
}

export function useRegisterAwardVestings(epoch: number, company: string, award: string, guard: () => void) {
  return useQuery({
    queryKey: awardVestingsKey(epoch, award),
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardVestings(
          apiClient,
          { company, award, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard, signal },
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
  });
}

export const awardEndsKey = (epoch: number, award: string) => [...registerKey(epoch), 'award-ends', award];
export const awardVestingReversalsKey = (epoch: number, award: string) => [
  ...registerKey(epoch),
  'award-vesting-reversals',
  award,
];

export function useRegisterAwardEnds(epoch: number, company: string, award: string, guard: () => void) {
  return useQuery({
    queryKey: awardEndsKey(epoch, award),
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardEnds(
          apiClient,
          { company, award, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard, signal },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.award !== award || !hasValidRegisterAwardEnd(row)))
        throw new Error('The entitlement changes do not belong to this award.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
  });
}

export function useRegisterAwardVestingReversals(epoch: number, company: string, award: string, guard: () => void) {
  return useQuery({
    queryKey: awardVestingReversalsKey(epoch, award),
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardVestingReversals(
          apiClient,
          { company, award, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard, signal },
        );
        guard();
        return response;
      });
      if (
        rows.some((row) => row.company !== company || row.award !== award || !hasValidRegisterAwardVestingReversal(row))
      )
        throw new Error('The vesting corrections do not belong to this award.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
  });
}
