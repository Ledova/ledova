import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  failureStatus,
  getClassOwnershipHolders,
  getCompanyOwnership,
  type CompanyOwnershipSummary,
  type ClassOwnershipHolders,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { PAGE_SIZE, useListParams } from '@hooks/useListParams';
import apiClient from '@services/apiClient';

const WHOLE = /^(0|[1-9][0-9]*)$/;
const count = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;

function checkOverview(data: CompanyOwnershipSummary, company: string, expected: string[]) {
  if (
    data.company !== company ||
    data.classes.length !== expected.length ||
    new Set(data.classes.map(({ uuid }) => uuid)).size !== expected.length ||
    data.classes.some((item) => !expected.includes(item.uuid))
  )
    throw new Error('Ownership did not identify every class for this company.');
  for (const row of data.classes) {
    if (
      row.initialized &&
      (row.issuedSupply === null || !WHOLE.test(row.issuedSupply) || !count(row.totalHolders) || !count(row.sequence))
    )
      throw new Error('Ownership did not identify complete class quantities.');
  }
  if (data.complete) {
    if (
      data.classes.some(({ initialized }) => !initialized) ||
      data.issuedSupply === null ||
      !WHOLE.test(data.issuedSupply) ||
      !count(data.totalHolders) ||
      data.classes.reduce((total, row) => total + BigInt(row.issuedSupply!), 0n) !== BigInt(data.issuedSupply)
    )
      throw new Error('Ownership totals do not agree with the recorded classes.');
  } else if (
    data.issuedSupply !== null ||
    data.totalHolders !== null ||
    data.classes.every(({ initialized }) => initialized)
  )
    throw new Error('Ownership totals are not complete.');
  return data;
}

function checkHolders(
  data: ClassOwnershipHolders,
  token: CompanyOwnershipSummary['classes'][number],
  search: string,
  page: number,
) {
  if (
    data.token !== token.uuid ||
    data.sequence !== token.sequence ||
    data.issuedSupply !== token.issuedSupply ||
    !count(data.count) ||
    data.results.length > PAGE_SIZE ||
    data.results.length > data.count ||
    (data.results.length > 0 && (page - 1) * PAGE_SIZE + data.results.length > data.count) ||
    (!search && data.count !== token.totalHolders) ||
    new Set(data.results.map(({ member }) => member)).size !== data.results.length ||
    data.results.some(({ balance }) => !WHOLE.test(balance) || balance === '0') ||
    data.results.reduce((total, { balance }) => total + BigInt(balance), 0n) > BigInt(data.issuedSupply)
  )
    throw new Error('Shareholder quantities do not match this ownership snapshot.');
  return data;
}

export function useOwnership(owner: OrderSubmissionOwner, guard: () => void) {
  const client = useQueryClient();
  const classes = useRegisterClasses(owner, guard);
  const [chosen, setChosen] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const list = useListParams(['class']);
  const listed = classes.data ?? [];
  const companies = [...new Map(listed.map((item) => [item.companyUuid, item.companyName])).entries()].map(
    ([uuid, name]) => ({ uuid, name }),
  );
  const company = companies.length === 1 ? companies[0] : companies.find(({ uuid }) => uuid === chosen);
  const expected = listed.filter((item) => item.companyUuid === company?.uuid).map(({ uuid }) => uuid);
  const overview = useQuery({
    queryKey: [...registerKey(owner), 'ownership', company?.uuid, ...expected],
    enabled: !!company && classes.isSuccess && !classes.isFetching,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyOwnership(apiClient, company!.uuid, { ledovaSubmissionGuard: guard });
      guard();
      return checkOverview(data, company!.uuid, expected);
    },
    ...READ_TIMING,
  });
  const ready = classes.isSuccess && !classes.isFetching && overview.isSuccess && !overview.isFetching;
  const selected = ready ? overview.data.classes.find(({ uuid }) => uuid === list.filters.class) : undefined;
  const held = !!company && unconfirmed === company.uuid;
  const holders = useQuery({
    queryKey: [
      ...registerKey(owner),
      'ownership-holders',
      company?.uuid,
      selected?.uuid,
      selected?.sequence,
      list.search,
      list.page,
    ],
    enabled: ready && !held && !!selected?.initialized && selected.issuedSupply !== null && selected.sequence !== null,
    queryFn: async () => {
      guard();
      const { data } = await getClassOwnershipHolders(
        apiClient,
        selected!.uuid,
        { sequence: selected!.sequence!, page: list.page, page_size: PAGE_SIZE, search: list.search },
        { ledovaSubmissionGuard: guard },
      );
      guard();
      return checkHolders(data, selected!, list.search, list.page);
    },
    ...READ_TIMING,
    retry: false,
  });
  const denied = [401, 403, 404].includes(failureStatus(holders.error) ?? 0);
  useEffect(() => {
    if (failureStatus(holders.error) === 409) void overview.refetch();
    if (denied && company && !held) {
      setUnconfirmed(company.uuid);
      void classes.refetch();
      void overview.refetch();
    }
  }, [holders.error, denied, company?.uuid, held]);
  const select = (uuid: string | null) => {
    list.clear();
    list.setFilter('class', uuid ?? '');
  };
  return {
    classes,
    companies,
    company,
    adoptCompany: setChosen,
    selectCompany: (uuid: string) => {
      setChosen(uuid);
      select(null);
    },
    overview,
    scopeError: held || denied,
    recover: async () => {
      try {
        guard();
        const refreshed = await classes.refetch();
        if (!refreshed.isSuccess) return;
        if (!company) return;
        const snapshot = await overview.refetch();
        guard();
        if (!snapshot.isSuccess || snapshot.data.company !== company.uuid) return;
        await client.resetQueries({ queryKey: [...registerKey(owner), 'ownership-holders', company.uuid] });
        guard();
        if (failureStatus(holders.error) === 404 && list.page > 1) list.setPage(1, true);
        setUnconfirmed(null);
      } catch {
        return;
      }
    },
    selected,
    select,
    holders,
    list,
  };
}
