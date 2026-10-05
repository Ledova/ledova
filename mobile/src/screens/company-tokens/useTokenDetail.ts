import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyToken,
  getCompany,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  deployCompanyToken,
  readEveryPage,
  submitCapitalIncrease,
  wholeShares,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { checkedRegister, useCompanyAccess } from '../company-register/useCompanyRegister';

export function useTokenDetail(uuid: string) {
  const queryClient = useQueryClient();
  const access = useCompanyAccess();
  const token = useQuery({
    queryKey: ['company-token', uuid],
    enabled: !!uuid && access.allowed,
    queryFn: async () => {
      const { data } = await getCompanyToken(apiClient, uuid);
      if (data.uuid !== uuid || wholeShares(data.totalSupply) === null) throw new Error('Invalid share class');
      return data;
    },
  });
  const enabled = access.allowed && !!token.data && !token.isError;
  const company = useQuery({
    queryKey: ['company', token.data?.companyUuid],
    enabled,
    queryFn: () => getCompany(apiClient, token.data!.companyUuid).then(({ data }) => data),
  });
  const register = useQuery({
    queryKey: ['company-token', uuid, 'holders'],
    enabled,
    queryFn: async () => checkedRegister(uuid, (await getCompanyTokenHolders(apiClient, uuid)).data),
  });
  const issuances = useQuery({
    queryKey: ['company-token', uuid, 'issuances'],
    enabled,
    queryFn: () => readEveryPage((page) => getCompanyTokenIssuances(apiClient, uuid, { page })),
  });
  const capital = useQuery({
    queryKey: ['company-token', uuid, 'capital-increases'],
    enabled,
    queryFn: () => readEveryPage((page) => getCapitalIncreases(apiClient, { token: uuid, page })),
  });
  const requests = useQuery({
    queryKey: ['company-token', uuid, 'issuance-requests'],
    enabled,
    queryFn: () => readEveryPage((page) => getShareIssuanceRequests(apiClient, { token: uuid, page })),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['company-token', uuid] }),
      queryClient.invalidateQueries({ queryKey: ['company-tokens'] }),
      queryClient.invalidateQueries({ queryKey: ['company', token.data?.companyUuid] }),
    ]);
  const deploy = useMutation({ mutationFn: () => deployCompanyToken(apiClient, uuid), onSuccess: refresh });
  const submitCapital = useMutation({
    mutationFn: (requestUuid: string) => submitCapitalIncrease(apiClient, requestUuid),
    onSuccess: refresh,
  });
  return { access, token, company, register, issuances, capital, requests, deploy, submitCapital, refresh };
}
