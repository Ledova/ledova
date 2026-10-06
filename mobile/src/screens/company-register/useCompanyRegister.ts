import { useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  assertNextPageAdvances,
  canOpen,
  getCompanyTokenHolders,
  getOwnCompanyAppointments,
  getRegisterClasses,
  getRegisterCorrections,
  getRegisterEntries,
  getRegisterImports,
  getNextPageParam,
  getRegisterOpeningHolders,
  getRegisterOpenings,
  getRegisterReconciliations,
  hasWholeShares,
  readEveryPage,
  useLaterPages,
  useUserPreferences,
  type CompanyShareTokenListItem,
  type OwnCompanyAppointment,
  type RegisterCorrection,
  type RegisterEntry,
  type RegisterEntryQueryParams,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

const REGISTER_STEPS: RegisterStep[] = ['prepare', 'approve', 'apply', 'reject'];

export function checkedRegister(uuid: string, register: TokenHoldersResponse) {
  const quantities = [register.token.totalSupply, ...register.holders.map(({ balance }) => balance)];
  if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
  if (register.token.uuid !== uuid || quantities.some((value) => !/^\d+$/.test(value))) {
    throw new Error('Register quantities do not identify this share class');
  }
  return register;
}

export function useCompanyAccess() {
  const preferences = useUserPreferences();
  const role = preferences.userAccount?.role;
  return { ...preferences, allowed: !preferences.isError && !!role && canOpen(role, 'company') };
}

const registerKey = (epoch: number) => ['company-tokens', 'register', epoch];
const recordsKey = (records: string) => (epoch: number, scope?: string) => [
  ...registerKey(epoch),
  records,
  ...(scope ? [scope] : []),
];
export const importsKey = recordsKey('imports');
export const openingsKey = recordsKey('openings');
export const openingHoldersKey = (epoch: number, token: string) => ['opening-holders', epoch, token];
export const entriesKey = recordsKey('entries');
export const correctionsKey = recordsKey('corrections');
export const reconciliationKey = recordsKey('reconciliation');
export const registerAppointmentsKey = (epoch: number) => [...registerKey(epoch), 'appointments'];

function distinct<Row>(rows: Row[], uuid: (row: Row) => string) {
  const unique = new Map<string, Row>();
  for (const row of rows) if (!unique.has(uuid(row))) unique.set(uuid(row), row);
  return [...unique.values()];
}

async function sessionRead<Response>(epoch: number, read: () => Promise<Response>) {
  assertSessionEpoch(epoch);
  const response = await read();
  assertSessionEpoch(epoch);
  return response;
}

function readClasses(epoch: number, page: number, signal: AbortSignal) {
  return sessionRead(epoch, () => getRegisterClasses(apiClient, { page }, { ledovaSessionEpoch: epoch, signal }));
}

async function readRegister(epoch: number, uuid: string, signal: AbortSignal) {
  const { data } = await sessionRead(epoch, () =>
    getCompanyTokenHolders(apiClient, uuid, { ledovaSessionEpoch: epoch, signal }),
  );
  return checkedRegister(uuid, data);
}

function companiesOf(classes: CompanyShareTokenListItem[]) {
  const companies: { uuid: string; name: string; classes: CompanyShareTokenListItem[] }[] = [];
  for (const shareClass of classes) {
    let company = companies.find(({ uuid }) => uuid === shareClass.companyUuid);
    if (!company) {
      company = { uuid: shareClass.companyUuid, name: shareClass.companyName, classes: [] };
      companies.push(company);
    }
    company.classes.push(shareClass);
  }
  return companies;
}

export function useRegisterAccess(enabled: boolean) {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const firstPage = useQuery({
    queryKey: [...registerKey(epoch), 'access'],
    enabled,
    queryFn: async ({ signal }) => (await readClasses(epoch, 1, signal)).data.results.length > 0,
  });
  return enabled && firstPage.data === true;
}

export function useCompanyRegister(epoch: number) {
  const queryClient = useQueryClient();
  const [selected, selectCompany] = useState<string>();
  const classes = useQuery({
    queryKey: [...registerKey(epoch), 'classes'],
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage((page) => readClasses(epoch, page, signal));
      if (new Set(rows.map(({ uuid }) => uuid)).size !== rows.length) {
        throw new Error('The register lists a share class more than once');
      }
      return rows;
    },
  });
  const companies = companiesOf(classes.isSuccess ? classes.data : []);
  const company =
    companies.find(({ uuid }) => uuid === selected) ?? (companies.length === 1 ? companies[0] : undefined);
  const registers = useQuery({
    queryKey: [...registerKey(epoch), 'holders', company?.uuid, company?.classes.map(({ uuid }) => uuid)],
    enabled: !!company,
    queryFn: ({ signal }) => Promise.all(company!.classes.map(({ uuid }) => readRegister(epoch, uuid, signal))),
  });
  return {
    classes,
    companies,
    company,
    selectCompany,
    registers,
    isFetching: classes.isFetching || registers.isFetching,
    refresh: () =>
      Promise.all([
        classes.refetch(),
        ...(company ? [registers.refetch()] : []),
        ...[openingsKey, importsKey, entriesKey, correctionsKey, reconciliationKey, registerAppointmentsKey].map(
          (key) => queryClient.refetchQueries({ queryKey: key(epoch), type: 'active' }),
        ),
      ]),
  };
}

export function useClassRegister(epoch: number, token: string) {
  return useQuery({
    queryKey: [...registerKey(epoch), 'class', token],
    queryFn: ({ signal }) => readRegister(epoch, token, signal),
  });
}

export function useRegisterImports(epoch: number, company: string, token: string) {
  return useQuery({
    queryKey: importsKey(epoch, token),
    queryFn: async ({ signal }) => {
      const rows = distinct(
        await readEveryPage((page) =>
          sessionRead(epoch, () =>
            getRegisterImports(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal }),
          ),
        ),
        ({ uuid }) => uuid,
      );
      if (rows.some((row) => row.token !== token || row.company !== company)) {
        throw new Error('The imports do not belong to this share class');
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
  });
}

export function useRegisterOpenings(epoch: number, company: string, token: string) {
  return useQuery({
    queryKey: openingsKey(epoch, token),
    queryFn: async ({ signal }) => {
      const rows = distinct(
        await readEveryPage((page) =>
          sessionRead(epoch, () =>
            getRegisterOpenings(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal }),
          ),
        ),
        ({ uuid }) => uuid,
      );
      if (rows.some((row) => row.token !== token || row.company !== company)) {
        throw new Error('The openings do not belong to this share class');
      }
      if (rows.some((row) => !hasWholeShares(row.boundarySummary?.holdings ?? []))) {
        throw new Error('The openings record a holding that is not whole');
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
  });
}

export function useOpeningHolders(epoch: number, token: string) {
  return useQuery({
    queryKey: openingHoldersKey(epoch, token),
    queryFn: async ({ signal }) => {
      const { data } = await sessionRead(epoch, () =>
        getRegisterOpeningHolders(apiClient, token, { ledovaSessionEpoch: epoch, signal }),
      );
      if (!hasWholeShares(data.holdings)) throw new Error('The chain holdings record a share count that is not whole');
      return data;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useRegisterAppointments(epoch: number, company: string) {
  const appointments = useQuery({
    queryKey: registerAppointmentsKey(epoch),
    queryFn: ({ signal }) =>
      readEveryPage((page) =>
        sessionRead(epoch, () => getOwnCompanyAppointments(apiClient, page, { ledovaSessionEpoch: epoch, signal })),
      ),
  });
  const steps = appointments.isSuccess
    ? (Object.fromEntries(
        REGISTER_STEPS.map((step) => [step, appointmentForRegisterStep(appointments.data, company, step)]),
      ) as Record<RegisterStep, OwnCompanyAppointment | undefined>)
    : undefined;
  return { appointments, steps };
}

async function readEntries(epoch: number, token: string, params: RegisterEntryQueryParams, signal: AbortSignal) {
  const response = await sessionRead(epoch, () =>
    getRegisterEntries(apiClient, token, params, { ledovaSessionEpoch: epoch, signal }),
  );
  if (response.data.results.some(({ changes }) => changes.some(({ shares }) => !/^-?\d+$/.test(shares)))) {
    throw new Error('The register entries record a share change that is not whole');
  }
  return response;
}

async function readNamedEntries(epoch: number, token: string, entry: string[], signal: AbortSignal) {
  if (entry.length === 0) return new Map<string, RegisterEntry>();
  const rows = await readEveryPage((page) => readEntries(epoch, token, { entry, page }, signal));
  if (rows.some(({ uuid }) => !entry.includes(uuid))) {
    throw new Error('The register answered with entries it was not asked for');
  }
  return new Map(rows.map((row) => [row.uuid, row]));
}

export function useRegisterEntries(epoch: number, token: string) {
  const queryKey = entriesKey(epoch, token);
  const entries = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await readEntries(epoch, token, { page: pageParam }, signal);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    initialPageParam: 1,
    getNextPageParam,
  });
  const pages = useLaterPages(queryKey, entries);
  const listed = distinct(entries.data?.pages.flatMap(({ results }) => results) ?? [], ({ uuid }) => uuid);
  return {
    entries,
    listed: listed.sort((left, right) => right.sequence - left.sequence),
    ...pages,
  };
}

export function useRegisterEntry(epoch: number, token: string, uuid: string) {
  return useQuery({
    queryKey: [...entriesKey(epoch, token), uuid],
    queryFn: async ({ signal }) => (await readNamedEntries(epoch, token, [uuid], signal)).get(uuid) ?? null,
  });
}

async function readCorrectionsPage(epoch: number, token: string, page: number, signal: AbortSignal) {
  const { data } = await sessionRead(epoch, () =>
    getRegisterCorrections(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal }),
  );
  const corrected = await readNamedEntries(
    epoch,
    token,
    [...new Set(data.results.map(({ corrects }) => corrects))],
    signal,
  );
  return {
    data: {
      ...data,
      results: data.results.map((proposal) => {
        const entry = corrected.get(proposal.corrects);
        if (!entry) throw new Error('A correction names an entry the register of this share class does not list');
        return { proposal, corrected: entry };
      }),
    },
  };
}

export function useRegisterCorrections(epoch: number, company: string, token: string) {
  return useQuery({
    queryKey: correctionsKey(epoch, token),
    queryFn: async ({ signal }) => {
      const rows = distinct(
        await readEveryPage((page) => readCorrectionsPage(epoch, token, page, signal)),
        ({ proposal }) => proposal.uuid,
      );
      const proposals: RegisterCorrection[] = rows.map(({ proposal }) => proposal);
      if (
        proposals.some((proposal) => proposal.company !== company) ||
        new Set(proposals.map(({ register }) => register)).size > 1
      ) {
        throw new Error('The corrections do not belong to this share class');
      }
      return rows.sort((left, right) => Date.parse(right.proposal.createdAt) - Date.parse(left.proposal.createdAt));
    },
  });
}

export function useRegisterReconciliation(epoch: number, token: string) {
  return useQuery({
    queryKey: reconciliationKey(epoch, token),
    queryFn: async ({ signal }) => {
      const { data } = await sessionRead(epoch, () =>
        getRegisterReconciliations(apiClient, { token }, { ledovaSessionEpoch: epoch, signal }),
      );
      if (data.results.some((row) => row.token !== token)) {
        throw new Error('The reconciliations do not belong to this share class');
      }
      return data.results[0] ?? null;
    },
  });
}
