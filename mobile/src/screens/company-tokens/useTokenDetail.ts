import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyToken,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  readEveryPage,
  useSubmissionOwner,
  wholeShares,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { COMPANY_TOKENS_QUERY_KEY } from '../../hooks/useCompanyTokens';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { checkedRegister } from '../company-register/useCompanyRegister';
import { registerDeploymentAppointmentsKey, registerDeploymentsKey } from './useDeploymentReads';

export function companyTokenPrefix(uuid: string) {
  return ['company-token', uuid];
}

export function companyTokenKey(uuid: string, epoch: number, owner: OrderSubmissionOwner | null | undefined) {
  return [...companyTokenPrefix(uuid), epoch, owner?.userUuid, owner?.ownerAccountUuid];
}

export function useTokenDetail(uuid: string) {
  const queryClient = useQueryClient();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = useCallback(() => {
    assertSessionEpoch(epoch);
    if (!mounted.current || !owner || boundary.get() !== owner)
      throw new Error('The account changed. Reopen the share class to continue.');
  }, [boundary, epoch, owner]);
  const tokenKey = companyTokenKey(uuid, epoch, owner);
  const config = (signal?: AbortSignal) => ({ signal, ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard });
  const read = async <Response>(request: () => Promise<Response>) => {
    guard();
    const response = await request();
    guard();
    return response;
  };
  const token = useQuery({
    queryKey: tokenKey,
    enabled: !!uuid && !!owner,
    queryFn: async ({ signal }) => {
      const { data } = await read(() => getCompanyToken(apiClient, uuid, config(signal)));
      if (data.uuid !== uuid || !data.companyUuid || wholeShares(data.totalSupply) === null)
        throw new Error('Invalid share class');
      return data;
    },
  });
  const enabled = !!owner && token.isSuccess && !!token.data && !token.isError;
  const isOwner = enabled && token.data!.isOwner === true;
  const ownerReads = isOwner && !token.isFetching;
  const register = useQuery({
    queryKey: [...tokenKey, 'holders'],
    enabled,
    queryFn: async ({ signal }) => {
      const result = checkedRegister(
        uuid,
        (await read(() => getCompanyTokenHolders(apiClient, uuid, config(signal)))).data,
      );
      return result;
    },
  });
  const issuances = useQuery({
    queryKey: [...tokenKey, 'issuances'],
    enabled: ownerReads,
    queryFn: ({ signal }) =>
      readEveryPage((page) => read(() => getCompanyTokenIssuances(apiClient, uuid, { page }, config(signal)))),
  });
  const capital = useQuery({
    queryKey: [...tokenKey, 'capital-increases'],
    enabled: ownerReads,
    queryFn: ({ signal }) =>
      readEveryPage((page) => read(() => getCapitalIncreases(apiClient, { token: uuid, page }, config(signal)))),
  });
  const requests = useQuery({
    queryKey: [...tokenKey, 'issuance-requests'],
    enabled: ownerReads,
    queryFn: ({ signal }) =>
      readEveryPage((page) => read(() => getShareIssuanceRequests(apiClient, { token: uuid, page }, config(signal)))),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: tokenKey }),
      queryClient.invalidateQueries({ queryKey: COMPANY_TOKENS_QUERY_KEY }),
      queryClient.invalidateQueries({
        queryKey: registerDeploymentsKey(epoch, owner, uuid),
      }),
      queryClient.invalidateQueries({
        queryKey: registerDeploymentAppointmentsKey(epoch, owner, uuid),
      }),
    ]);
  return {
    owner,
    boundary,
    epoch,
    guard,
    tokenKey,
    token,
    isOwner,
    register,
    issuances,
    capital,
    requests,
    refresh,
  };
}
