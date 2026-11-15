import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCompanyToken } from '../services/company-tokens';
import type { CompanyShareToken } from '../types';
import { createUserFriendlyError } from '../utils/errors';
import { wholeShares } from '../utils/share-quantities';
import { useApiClient } from './useApiClient';
import { useImportRegister } from './useImportRegister';
import { useSubmissionOwner, type OrderSubmissionSession } from './useSubmissionOwner';

export function shareClassKey(uuid: string) {
  return ['token', uuid];
}

export function useShareClass(uuid: string, session?: OrderSubmissionSession, available = true) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const [view, setView] = useState({ owner, generation: 0 });
  if (view.owner !== owner) setView({ owner, generation: view.generation + 1 });
  const [readHolds, setReadHolds] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);
  const sourceAvailable = useRef(available);
  useLayoutEffect(() => {
    sourceAvailable.current = available;
  }, [available]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const accountGuard = () => {
    if (!mounted.current || !owner || boundary.get() !== owner)
      throw createUserFriendlyError('Your signed-in account changed. Reopen the share class.');
  };
  const guard = () => {
    accountGuard();
    if (!sourceAvailable.current) throw createUserFriendlyError('Your company access could not be confirmed.');
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
  const config = () => ({ ...session?.requestConfig(), ledovaSubmissionGuard: guard });
  const token = useQuery({
    queryKey: tokenKey,
    enabled: available && !!uuid && !!owner,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      guard();
      const { data } = await getCompanyToken(apiClient, uuid, config());
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
  const enabled = available && !!owner && token.isSuccess;
  const register = useImportRegister(owner, uuid, enabled, guard, session);
  return {
    owner,
    guard,
    accountGuard,
    tokenKey,
    readingPaused,
    holdReads,
    token,
    register,
  };
}
