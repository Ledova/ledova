import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import {
  getRegisterAward,
  getRegisterAwardEnds,
  getRegisterAwardVestingReversals,
  getRegisterAwardVestings,
  getRegisterAwards,
} from '../services/register-awards';
import { readEveryPage } from '../utils/pagination';
import {
  hasValidRegisterAwardEnd,
  hasValidRegisterAwardTotals,
  hasValidRegisterAwardVestingReversal,
} from '../utils/register-awards';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function awardsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'awards', token];
}

export function awardVestingsKey(owner: OrderSubmissionOwner, award: string) {
  return [...registerKey(owner), 'award-vestings', award];
}

export function awardEndsKey(owner: OrderSubmissionOwner, award: string) {
  return [...registerKey(owner), 'award-ends', award];
}

export function awardVestingReversalsKey(owner: OrderSubmissionOwner, award: string) {
  return [...registerKey(owner), 'award-vesting-reversals', award];
}

export function useRegisterAwards(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: awardsKey(owner, token),
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwards(
          apiClient,
          { company, token, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
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
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: [...awardsKey(owner, token), uuid],
    enabled: enabled && !!uuid && !!company,
    queryFn: async () => {
      guard();
      const { data } = await getRegisterAward(apiClient, uuid, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
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
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: awardVestingsKey(owner, award),
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardVestings(
          apiClient,
          { company, award, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
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

export function useRegisterAwardEnds(
  owner: OrderSubmissionOwner,
  company: string,
  award: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: awardEndsKey(owner, award),
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardEnds(
          apiClient,
          { company, award, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
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
    ...READ_TIMING,
  });
}

export function useRegisterAwardVestingReversals(
  owner: OrderSubmissionOwner,
  company: string,
  award: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: awardVestingReversalsKey(owner, award),
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwardVestingReversals(
          apiClient,
          { company, award, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
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
    ...READ_TIMING,
  });
}
