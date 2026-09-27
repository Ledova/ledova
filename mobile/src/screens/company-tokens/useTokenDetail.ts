import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  getCompanyToken,
  getCompany,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  deployCompanyToken,
  submitCapitalIncrease,
  COMPANY_TOKEN_ENDPOINTS,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { getSessionEpoch, assertSessionEpoch } from '../../services/sessionScope';
import { checkedRegister, everyCompanyPage, useCompanyAccess } from '../company-register/useCompanyRegister';
import { wholeShares } from './shareQuantities';

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
    queryFn: () => everyCompanyPage((page) => getCompanyTokenIssuances(apiClient, uuid, { page })),
  });
  const capital = useQuery({
    queryKey: ['company-token', uuid, 'capital-increases'],
    enabled,
    queryFn: () => everyCompanyPage((page) => getCapitalIncreases(apiClient, { token: uuid, page })),
  });
  const requests = useQuery({
    queryKey: ['company-token', uuid, 'issuance-requests'],
    enabled,
    queryFn: () => everyCompanyPage((page) => getShareIssuanceRequests(apiClient, { token: uuid, page })),
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
  const download = useMutation({
    mutationFn: async () => {
      const epoch = getSessionEpoch();
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      assertSessionEpoch(epoch);
      await shareDocumentCopy(
        epoch,
        async () => {
          const { data } = await apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT(uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          });
          return { name: `register-${uuid}.csv`, type: 'text/csv', bytes: new Uint8Array(data) };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: 'public.comma-separated-values-text' }),
      );
    },
  });
  return { access, token, company, register, issuances, capital, requests, deploy, submitCapital, download, refresh };
}
