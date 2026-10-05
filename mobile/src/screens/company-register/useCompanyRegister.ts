import { useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  canOpen,
  getCompanyTokenHolders,
  getOwnCompanyAppointments,
  getRegisterClasses,
  getRegisterImports,
  readEveryPage,
  useUserPreferences,
  type CompanyShareTokenListItem,
  type OwnCompanyAppointment,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

const IMPORT_STEPS: RegisterStep[] = ['prepare', 'approve', 'apply', 'reject'];

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
export const importsKey = (epoch: number, token?: string) => [
  ...registerKey(epoch),
  'imports',
  ...(token ? [token] : []),
];
export const importAppointmentsKey = (epoch: number) => [...registerKey(epoch), 'appointments'];

async function readClasses(epoch: number, page: number, signal: AbortSignal) {
  assertSessionEpoch(epoch);
  const response = await getRegisterClasses(apiClient, { page }, { ledovaSessionEpoch: epoch, signal });
  assertSessionEpoch(epoch);
  return response;
}

async function readRegister(epoch: number, uuid: string, signal: AbortSignal) {
  assertSessionEpoch(epoch);
  const { data } = await getCompanyTokenHolders(apiClient, uuid, { ledovaSessionEpoch: epoch, signal });
  assertSessionEpoch(epoch);
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
        queryClient.refetchQueries({ queryKey: importsKey(epoch), type: 'active' }),
        queryClient.refetchQueries({ queryKey: importAppointmentsKey(epoch), type: 'active' }),
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
      const rows = await readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getRegisterImports(apiClient, { token, page }, { ledovaSessionEpoch: epoch, signal });
        assertSessionEpoch(epoch);
        return response;
      });
      if (rows.some((row) => row.token !== token || row.company !== company)) {
        throw new Error('The imports do not belong to this share class');
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
  });
}

export function useImportAppointments(epoch: number, company: string) {
  const appointments = useQuery({
    queryKey: importAppointmentsKey(epoch),
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getOwnCompanyAppointments(apiClient, page, { ledovaSessionEpoch: epoch, signal });
        assertSessionEpoch(epoch);
        return response;
      }),
  });
  const steps = appointments.isSuccess
    ? (Object.fromEntries(
        IMPORT_STEPS.map((step) => [step, appointmentForRegisterStep(appointments.data, company, step)]),
      ) as Record<RegisterStep, OwnCompanyAppointment | undefined>)
    : undefined;
  return { appointments, steps };
}
