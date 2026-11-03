import { useQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getRegisterAwards } from '../services/register-awards';
import { getRegisterEntries } from '../services/register-corrections';
import { firstOfEach, readEveryPage } from '../utils/pagination';
import { hasValidRegisterAwardTotals } from '../utils/register-awards';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { usePeople } from './usePeople';
import { useRegisterClasses } from './useRegisterClasses';
import { useRegisters } from './useRegisters';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function registerEntriesKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'entries'];
}

export function entriesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerEntriesKey(owner), token];
}

async function readMemberEntries(
  apiClient: AxiosInstance,
  tokens: string[],
  member: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const classes = await Promise.all(
    tokens.map(async (token) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterEntries(
          apiClient,
          token,
          { member, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return result;
      });
      if (rows.some((row) => !row.changes.some((change) => change.member === member)))
        throw new Error('The register answered with entries for another member.');
      if (rows.some((row) => row.changes.some((change) => !/^-?\d+$/.test(String(change.shares)))))
        throw new Error('The register entries did not give whole share changes.');
      return firstOfEach(rows, ({ uuid }) => uuid).map((entry) => ({ token, entry }));
    }),
  );
  return classes
    .flat()
    .sort(
      (left, right) =>
        right.entry.effectiveOn.localeCompare(left.entry.effectiveOn) ||
        Date.parse(right.entry.recordedAt) - Date.parse(left.entry.recordedAt),
    );
}

export function useShareholder(
  owner: OrderSubmissionOwner,
  guard: () => void,
  company: string,
  member: string,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const classes = useRegisterClasses(owner, guard, session);
  const listed = (classes.data ?? []).filter((item) => item.companyUuid === company);
  const tokens = listed.map(({ uuid }) => uuid);
  const registers = useRegisters(owner, tokens, guard, session);
  const particulars = usePeople(owner, tokens[0] ?? '', guard, tokens.length > 0, session);
  const entries = useQuery({
    queryKey: [...registerEntriesKey(owner), 'member', member, ...tokens],
    enabled: tokens.length > 0,
    queryFn: () => readMemberEntries(apiClient, tokens, member, guard, session),
    ...READ_TIMING,
  });
  const awards = useQuery({
    queryKey: [...registerKey(owner), 'member-awards', company, member],
    enabled: tokens.length > 0,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAwards(
          apiClient,
          { company, member, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.member !== member || !hasValidRegisterAwardTotals(row)))
        throw new Error('The awards do not belong to this shareholder or have inconsistent quantities.');
      return rows;
    },
    ...READ_TIMING,
  });
  const named = listed[0];
  return {
    classes,
    company: named ? { uuid: company, name: named.companyName } : undefined,
    tokens,
    registers,
    particulars,
    entries,
    awards,
  };
}
