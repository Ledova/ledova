import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { TOKENS_QUERY_KEY } from '@pages/company/shared/useTokensList';
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCompanyToken,
  getCompanyTokenHolders,
  getCompanyTokenIssuances,
  getCapitalIncreases,
  getShareIssuanceRequests,
  ownershipSummary,
  wholeShares,
  useSubmissionOwner,
  createUserFriendlyError,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { guarded } from '@pages/company/ledger/shared/registerReads';
import { useRecordFeed } from '@pages/company/ledger/shared/useRecordFeed';

export function shareClassKey(uuid: string) {
  return ['token', uuid];
}

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
  const tokenKey = [...shareClassKey(uuid), owner?.userUuid, owner?.ownerAccountUuid];
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
      ownershipSummary([data]);
      return data;
    },
  });
  const issuances = useRecordFeed(
    [...tokenKey, 'issuances'],
    (page) => guarded(guard, () => getCompanyTokenIssuances(apiClient, uuid, { page }, config)),
    isOwner,
  );
  const capital = useRecordFeed(
    [...tokenKey, 'capital-increases'],
    (page) => guarded(guard, () => getCapitalIncreases(apiClient, { token: uuid, page }, config)),
    isOwner,
  );
  const requests = useRecordFeed(
    [...tokenKey, 'issuance-requests'],
    (page) => guarded(guard, () => getShareIssuanceRequests(apiClient, { token: uuid, page }, config)),
    isOwner,
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: shareClassKey(uuid) }),
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
    ]);
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
    refresh,
  };
}
