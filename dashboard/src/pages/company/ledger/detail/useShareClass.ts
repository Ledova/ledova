import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { TOKENS_QUERY_KEY } from '@hooks/useTokensList';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  type CompanyShareToken,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { guarded } from '@pages/company/ledger/shared/registerReads';
import { useRecordFeed } from './useRecordFeed';

export function shareClassKey(uuid: string) {
  return ['token', uuid];
}

export function useShareClass(uuid: string) {
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner();
  const [view, setView] = useState({ owner, generation: 0 });
  if (view.owner !== owner) setView({ owner, generation: view.generation + 1 });
  const [readHolds, setReadHolds] = useState<Record<string, boolean>>({});
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
  const company = queryClient.getQueryData<CompanyShareToken>(tokenKey)?.companyUuid ?? '';
  const scopeKey = [owner?.userUuid, owner?.ownerAccountUuid, uuid, company, view.generation].join('/');
  const readingPaused = Object.keys(readHolds).some((key) => key.startsWith(`${scopeKey}/`));
  const holdReads = useCallback(
    (name: string, held: boolean) => {
      const key = `${scopeKey}/${name}`;
      setReadHolds((previous) => {
        if (!!previous[key] === held) return previous;
        const next = { ...previous };
        if (held) next[key] = true;
        else delete next[key];
        return next;
      });
    },
    [scopeKey],
  );
  const config = { ledovaSubmissionGuard: guard };
  const token = useQuery({
    queryKey: tokenKey,
    enabled: !!uuid && !!owner,
    refetchOnWindowFocus: !readingPaused,
    refetchOnReconnect: !readingPaused,
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
    refetchOnWindowFocus: !readingPaused,
    refetchOnReconnect: !readingPaused,
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
    { paused: readingPaused },
  );
  const capital = useRecordFeed(
    [...tokenKey, 'capital-increases'],
    (page) => guarded(guard, () => getCapitalIncreases(apiClient, { token: uuid, page }, config)),
    isOwner,
    { paused: readingPaused },
  );
  const requests = useRecordFeed(
    [...tokenKey, 'issuance-requests'],
    (page) => guarded(guard, () => getShareIssuanceRequests(apiClient, { token: uuid, page }, config)),
    isOwner,
    { paused: readingPaused },
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
    scopeKey,
    readingPaused,
    holdReads,
    isOwner,
    token,
    register,
    issuances,
    capital,
    requests,
    refresh,
  };
}
