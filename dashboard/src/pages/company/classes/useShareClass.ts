import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyToken,
  getCompany,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  getNextPageParam,
  downloadTokenRegister,
  deployCompanyToken,
  submitCapitalIncrease,
  type PaginatedResponse,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { wholeShares } from './shareQuantities';

async function everyPage<T>(read: (page: number) => Promise<{ data: PaginatedResponse<T> }>): Promise<T[]> {
  const results: T[] = [];
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await read(page);
    results.push(...data.results);
    const next = getNextPageParam(data);
    if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
      throw new Error('Share class history pagination did not advance');
    }
    page = next;
  }
  return results;
}

export function useShareClass(uuid: string) {
  const queryClient = useQueryClient();
  const token = useQuery({
    queryKey: ['token', uuid],
    enabled: !!uuid,
    queryFn: async () => {
      const { data } = await getCompanyToken(apiClient, uuid);
      if (wholeShares(data.totalSupply) === null) throw new Error('Authorised shares are not a whole quantity');
      return data;
    },
  });
  const company = useQuery({
    queryKey: ['company', token.data?.companyUuid],
    enabled: !!token.data && !token.isError,
    queryFn: () => getCompany(apiClient, token.data!.companyUuid).then(({ data }) => data),
  });
  const enabled = !!token.data && !token.isError;
  const register = useQuery({
    queryKey: ['token', uuid, 'holders'],
    enabled,
    queryFn: async () => {
      const { data } = await getCompanyTokenHolders(apiClient, uuid);
      const quantities = [data.token.totalSupply, ...data.holders.map(({ balance }) => balance)];
      if (data.issuedSupply !== null) quantities.push(data.issuedSupply);
      if (data.token.uuid !== uuid || quantities.some((quantity) => wholeShares(quantity) === null)) {
        throw new Error('Register quantities do not identify this share class');
      }
      return data;
    },
  });
  const issuances = useQuery({
    queryKey: ['token', uuid, 'issuances'],
    enabled,
    queryFn: () => everyPage((page) => getCompanyTokenIssuances(apiClient, uuid, { page })),
  });
  const capital = useQuery({
    queryKey: ['token', uuid, 'capital-increases'],
    enabled,
    queryFn: () => everyPage((page) => getCapitalIncreases(apiClient, { token: uuid, page })),
  });
  const requests = useQuery({
    queryKey: ['token', uuid, 'issuance-requests'],
    enabled,
    queryFn: () => everyPage((page) => getShareIssuanceRequests(apiClient, { token: uuid, page })),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['token', uuid] }),
      queryClient.invalidateQueries({ queryKey: ['tokens'] }),
    ]);
  const deploy = useMutation({ mutationFn: () => deployCompanyToken(apiClient, uuid), onSuccess: refresh });
  const submitCapital = useMutation({
    mutationFn: (requestUuid: string) => submitCapitalIncrease(apiClient, requestUuid),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async () => {
      const { data } = await downloadTokenRegister(apiClient, uuid);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `register-${token.data?.symbol ?? uuid}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
  return { token, company, register, issuances, capital, requests, deploy, submitCapital, download, refresh };
}
