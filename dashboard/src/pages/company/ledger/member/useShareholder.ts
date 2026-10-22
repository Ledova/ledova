import { useQuery } from '@tanstack/react-query';
import {
  getRegisterAwards,
  hasValidRegisterAwardTotals,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { registersQuery, useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { readMemberEntries, registerEntriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { usePeople } from '@pages/company/ledger/shared/usePeople';

export function useShareholder(owner: OrderSubmissionOwner, guard: () => void, company: string, member: string) {
  const classes = useRegisterClasses(owner, guard);
  const listed = (classes.data ?? []).filter((item) => item.companyUuid === company);
  const tokens = listed.map(({ uuid }) => uuid);
  const registers = useQuery(registersQuery(owner, tokens, guard));
  const particulars = usePeople(owner, tokens[0] ?? '', guard, tokens.length > 0);
  const entries = useQuery({
    queryKey: [...registerEntriesKey(owner), 'member', member, ...tokens],
    enabled: tokens.length > 0,
    queryFn: () => readMemberEntries(tokens, member, guard),
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
          { ledovaSubmissionGuard: guard },
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
  return {
    classes,
    company: listed.length ? { uuid: company, name: listed[0].companyName } : undefined,
    tokens,
    registers,
    particulars,
    entries,
    awards,
  };
}
