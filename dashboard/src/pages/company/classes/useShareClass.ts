import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyToken,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  readEveryPage,
  wholeShares,
  useSubmissionOwner,
  createUserFriendlyError,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useRegisterDownload } from '../register/useCompanyRegister';

export function useShareClass(uuid: string) {
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = () => {
    if (!mounted.current || !owner || boundary.get() !== owner)
      throw createUserFriendlyError('Your signed-in account changed. Reopen the share class.');
  };
  const tokenKey = ['token', uuid, owner?.userUuid, owner?.ownerAccountUuid];
  const config = { ledovaSubmissionGuard: guard };
  const token = useQuery({
    queryKey: tokenKey,
    enabled: !!uuid && !!owner,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyToken(apiClient, uuid, config);
      guard();
      if (
        data.uuid !== uuid ||
        !data.companyUuid ||
        data.company !== data.companyUuid ||
        wholeShares(data.totalSupply) === null
      )
        throw new Error('The share class did not identify its company and authorised shares.');
      return data;
    },
  });
  const enabled = !!owner && token.isSuccess;
  const isOwner = enabled && !token.isFetching && token.data.isOwner === true;
  const register = useQuery({
    queryKey: [...tokenKey, 'holders'],
    enabled,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyTokenHolders(apiClient, uuid, config);
      guard();
      const quantities = [data.token.totalSupply, ...data.holders.map(({ balance }) => balance)];
      if (data.issuedSupply !== null) quantities.push(data.issuedSupply);
      if (data.token.uuid !== uuid || quantities.some((quantity) => wholeShares(quantity) === null)) {
        throw new Error('Register quantities do not identify this share class');
      }
      return data;
    },
  });
  const issuances = useQuery({
    queryKey: [...tokenKey, 'issuances'],
    enabled: isOwner,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanyTokenIssuances(apiClient, uuid, { page }, config);
        guard();
        return result;
      }),
  });
  const capital = useQuery({
    queryKey: [...tokenKey, 'capital-increases'],
    enabled: isOwner,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCapitalIncreases(apiClient, { token: uuid, page }, config);
        guard();
        return result;
      }),
  });
  const requests = useQuery({
    queryKey: [...tokenKey, 'issuance-requests'],
    enabled: isOwner,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getShareIssuanceRequests(apiClient, { token: uuid, page }, config);
        guard();
        return result;
      }),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['token', uuid] }),
      queryClient.invalidateQueries({ queryKey: ['tokens'] }),
    ]);
  const download = useRegisterDownload(uuid, token.data?.symbol);
  return {
    owner,
    boundary,
    guard,
    tokenKey,
    isOwner,
    token,
    register,
    issuances,
    capital,
    requests,
    download,
    refresh,
  };
}
