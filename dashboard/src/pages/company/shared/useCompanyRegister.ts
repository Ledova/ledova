import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  downloadTokenRegister,
  getCompanyTokenHolders,
  getRegisterClasses,
  readEveryPage,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { saveFile } from '@utils/saveFile';

export function useRegisterClasses(owner: OrderSubmissionOwner) {
  return useQuery({
    queryKey: [...registerKey(owner), 'classes'],
    queryFn: () => readEveryPage((page) => getRegisterClasses(apiClient, { page })),
    ...READ_TIMING,
  });
}

export async function readRegister(uuid: string) {
  const { data: register } = await getCompanyTokenHolders(apiClient, uuid);
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

export function registersQuery(owner: OrderSubmissionOwner, uuids: string[]) {
  return {
    queryKey: [...registerKey(owner), 'holders', ...uuids],
    enabled: uuids.length > 0,
    queryFn: () => Promise.all(uuids.map(readRegister)),
    ...READ_TIMING,
  };
}

export function useCompanyRegister(
  owner: OrderSubmissionOwner,
  retained?: { company: { uuid: string; name: string }; tokens: string[] },
) {
  const [selected, setSelected] = useState('');
  const classes = useRegisterClasses(owner);
  const listed = classes.data ?? [];
  const companies = [...new Map(listed.map((item) => [item.companyUuid, item.companyName])).entries()].map(
    ([uuid, name]) => ({ uuid, name }),
  );
  const company =
    retained?.company ?? (companies.length === 1 ? companies[0] : companies.find(({ uuid }) => uuid === selected));
  const uuids = retained?.tokens ?? listed.filter((item) => item.companyUuid === company?.uuid).map(({ uuid }) => uuid);
  const registers = useQuery(registersQuery(owner, uuids));
  return { classes, companies, company, selectCompany: setSelected, registers };
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
