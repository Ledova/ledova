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
  getRegisterReconciliations,
  readEveryPage,
  useLaterPages,
  useUserPreferences,
  type CompanyShareTokenListItem,
  type OwnCompanyAppointment,
  type PaginatedResponse,
  type RegisterEntry,
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

function checkedEntryPage(page: PaginatedResponse<RegisterEntry>) {
  if (page.results.some(({ changes }) => changes.some(({ shares }) => !/^-?\d+$/.test(shares)))) {
    throw new Error('The register entries record a share change that is not whole');
  }
  return page;
}

const registerKey = (epoch: number) => ['company-tokens', 'register', epoch];
const recordsKey = (records: string) => (epoch: number, scope?: string) => [
  ...registerKey(epoch),
  records,
  ...(scope ? [scope] : []),
];
export const importsKey = recordsKey('imports');
export const entriesKey = recordsKey('entries');
export const correctionsKey = recordsKey('corrections');
export const reconciliationKey = recordsKey('reconciliation');
export const registerAppointmentsKey = (epoch: number) => [...registerKey(epoch), 'appointments'];

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
        ...[importsKey, entriesKey, correctionsKey, reconciliationKey, registerAppointmentsKey].map((key) =>
          queryClient.refetchQueries({ queryKey: key(epoch), type: 'active' }),
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
      const rows = await readEveryPage((page) =>
        sessionRead(epoch, () => getRegisterImports(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal })),
      );
      if (rows.some((row) => row.token !== token || row.company !== company)) {
        throw new Error('The imports do not belong to this share class');
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
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

async function readEntryPage(epoch: number, token: string, page: number, signal: AbortSignal) {
  const { data } = await sessionRead(epoch, () =>
    getRegisterEntries(apiClient, token, { page }, { ledovaSessionEpoch: epoch, signal }),
  );
  assertNextPageAdvances(page, data);
  return checkedEntryPage(data);
}

export function useRegisterEntries(epoch: number, token: string) {
  const queryKey = entriesKey(epoch, token);
  const entries = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => readEntryPage(epoch, token, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam,
  });
  const pages = useLaterPages(queryKey, entries);
  const listed = new Map<string, RegisterEntry>();
  for (const entry of entries.data?.pages.flatMap(({ results }) => results) ?? []) {
    if (!listed.has(entry.uuid)) listed.set(entry.uuid, entry);
  }
  return {
    entries,
    listed: [...listed.values()].sort((left, right) => right.sequence - left.sequence),
    ...pages,
  };
}

export function useRegisterEntry(epoch: number, token: string, uuid: string) {
  return useQuery({
    queryKey: [...entriesKey(epoch, token), uuid],
    queryFn: async ({ signal }) => {
      let page: number | undefined = 1;
      while (page !== undefined) {
        const data = await readEntryPage(epoch, token, page, signal);
        const entry = data.results.find((row) => row.uuid === uuid);
        if (entry) return entry;
        page = getNextPageParam(data);
      }
      return null;
    },
  });
}

export function useRegisterCorrections(epoch: number, company: string, token: string) {
  return useQuery({
    queryKey: correctionsKey(epoch, token),
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage((page) =>
        sessionRead(epoch, () =>
          getRegisterCorrections(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal }),
        ),
      );
      if (rows.some((row) => row.company !== company) || new Set(rows.map(({ register }) => register)).size > 1) {
        throw new Error('The corrections do not belong to this share class');
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
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
