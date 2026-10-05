import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  downloadTokenRegister,
  getCompanyTokenHolders,
  getRegisterClasses,
  readEveryPage,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import apiClient from '@services/apiClient';

const READ_TIMING = { staleTime: CACHE_TIMING.SHORT_STALE_TIME, gcTime: CACHE_TIMING.MEDIUM_GC_TIME };

function registerKey(owner: OrderSubmissionOwner | null) {
  return ['tokens', 'register', owner?.userUuid, owner?.ownerAccountUuid];
}

export function useCompanyRegister(owner: OrderSubmissionOwner) {
  const [selected, setSelected] = useState('');
  const classes = useQuery({
    queryKey: [...registerKey(owner), 'classes'],
    queryFn: () => readEveryPage((page) => getRegisterClasses(apiClient, { page })),
    ...READ_TIMING,
  });
  const listed = classes.data ?? [];
  const companies = [...new Map(listed.map((item) => [item.companyUuid, item.companyName])).entries()].map(
    ([uuid, name]) => ({ uuid, name }),
  );
  const company = companies.length === 1 ? companies[0] : companies.find(({ uuid }) => uuid === selected);
  const uuids = listed.filter((item) => item.companyUuid === company?.uuid).map(({ uuid }) => uuid);
  const registers = useQuery({
    queryKey: [...registerKey(owner), 'holders', ...uuids],
    enabled: uuids.length > 0,
    queryFn: () =>
      Promise.all(
        uuids.map(async (uuid) => {
          const { data: register } = await getCompanyTokenHolders(apiClient, uuid);
          const quantities = [register.token.totalSupply, ...register.holders.map(({ balance }) => balance)];
          if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
          if (register.token.uuid !== uuid || quantities.some((value) => !/^\d+$/.test(value))) {
            throw new Error('Register did not identify exact share quantities for this class');
          }
          return register;
        }),
      ),
    ...READ_TIMING,
  });
  return { classes, companies, company, selectCompany: setSelected, registers };
}

export function useRegisterEntry() {
  const { owner } = useSubmissionOwner();
  const { isKnown, isCompany } = useRole();
  const access = useQuery({
    queryKey: [...registerKey(owner), 'access'],
    enabled: !!owner && isKnown && !isCompany,
    queryFn: async () => (await getRegisterClasses(apiClient, { page: 1 })).data.results.length > 0,
    ...READ_TIMING,
  });
  return access.isSuccess && access.data;
}

export function useRegisterDownload(uuid: string, symbol: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      const { data } = await downloadTokenRegister(apiClient, uuid);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `register-${symbol ?? uuid}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
}
