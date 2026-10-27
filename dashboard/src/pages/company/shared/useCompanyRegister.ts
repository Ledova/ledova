import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  downloadTokenRegister,
  getCompanyTokenHolders,
  hasCurrentRegisterReadAuthority,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import { registerHoldersKey, useRegisterClasses } from '@hooks/useRegisterClasses';
import { saveFile } from '@utils/saveFile';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

export async function readRegister(uuid: string, guard: () => void) {
  guard();
  const { data: register } = await getCompanyTokenHolders(apiClient, uuid, { ledovaSubmissionGuard: guard });
  guard();
  const quantities = [
    register.token.totalSupply,
    ...register.holders.map(({ balance }) => balance),
    ...(register.formerMembers ?? []).map(({ sharesAtCessation }) => sharesAtCessation),
  ];
  if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
  if (register.token.uuid !== uuid || quantities.some((value) => !/^\d+$/.test(value))) {
    throw new Error('Register did not identify exact share quantities for this class');
  }
  return register;
}

export function registersQuery(owner: OrderSubmissionOwner, uuids: string[], guard: () => void) {
  return {
    queryKey: [...registerHoldersKey(owner), ...uuids],
    enabled: uuids.length > 0,
    queryFn: () => Promise.all(uuids.map((uuid) => readRegister(uuid, guard))),
    ...READ_TIMING,
  };
}

export function useCompanyRegister(
  owner: OrderSubmissionOwner,
  guard: () => void,
  retained?: { company: { uuid: string; name: string }; tokens: string[] },
  includeEmptyCompanies = false,
  requestedCompany?: string,
) {
  const [selected, setSelected] = useState('');
  const classes = useRegisterClasses(owner, guard);
  const listed = classes.data ?? [];
  const appointments = useOwnAppointments(owner, guard, { enabled: includeEmptyCompanies });
  const extra =
    includeEmptyCompanies && appointments.isSuccess
      ? appointments.data
          .filter((item) => hasCurrentRegisterReadAuthority([item], item.company))
          .map((item) => [item.company, item.companyName] as const)
      : [];
  const companies = [
    ...new Map([...listed.map((item) => [item.companyUuid, item.companyName] as const), ...extra]).entries(),
  ].map(([uuid, name]) => ({ uuid, name }));
  const company =
    retained?.company ??
    (requestedCompany !== undefined
      ? companies.find(({ uuid }) => uuid === requestedCompany)
      : companies.length === 1
        ? companies[0]
        : companies.find(({ uuid }) => uuid === selected));
  const uuids = retained?.tokens ?? listed.filter((item) => item.companyUuid === company?.uuid).map(({ uuid }) => uuid);
  const empty = includeEmptyCompanies && !!company && uuids.length === 0;
  const registers = useQuery({
    ...registersQuery(owner, uuids, guard),
    ...(empty
      ? {
          queryKey: [...registerHoldersKey(owner), 'empty', company.uuid],
          enabled: true,
          queryFn: async () => {
            guard();
            return [];
          },
        }
      : {}),
  });
  return {
    classes,
    companies,
    company,
    selectCompany: setSelected,
    registers,
    companyAppointments: appointments,
  };
}

export function useRegisterDownload(uuid: string, symbol: string | undefined) {
  const { owner, boundary } = useSubmissionOwner();
  return useMutation({
    mutationFn: async () => {
      const guard = () => {
        if (!owner || boundary.get() !== owner)
          throw new Error('Your signed-in account changed. Reopen the register to download it.');
      };
      guard();
      const { data } = await downloadTokenRegister(apiClient, uuid, { ledovaSubmissionGuard: guard });
      guard();
      saveFile(data, `register-${symbol ?? uuid}.csv`);
    },
  });
}
