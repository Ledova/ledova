import { INVESTOR_ELIGIBILITY_QUERY_KEY } from './useMarket';
import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getDirectoryDocuments, getDirectoryToken, getDirectoryTokens } from '../services/directory';
import { getInvestorReadiness } from '../services/investorClassifications';
import { getOperator } from '../services/operator';
import { readEveryPage } from '../utils/pagination';
import { failureStatus } from '../utils/errors';
import { useApiClient } from './useApiClient';

export const DIRECTORY_QUERY_KEY = ['directory'] as const;
export const OPERATOR_QUERY_KEY = ['operator'] as const;

export function useDirectoryTokens() {
  const apiClient = useApiClient();
  const eligibility = useQuery({
    queryKey: INVESTOR_ELIGIBILITY_QUERY_KEY,
    queryFn: () => getInvestorReadiness(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const tokens = useQuery({
    queryKey: [...DIRECTORY_QUERY_KEY, 'tokens', 'complete'],
    queryFn: () => readEveryPage((page) => getDirectoryTokens(apiClient, page)),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    tokens: tokens.isError || tokens.isFetching ? [] : (tokens.data ?? []),
    isReady: eligibility.data?.data?.isReady ?? false,
    isLoading: tokens.isLoading || eligibility.isLoading,
    hasError: eligibility.isError || tokens.isError,
    isRefreshing: tokens.isFetching || eligibility.isFetching,
    retry: () => Promise.all([eligibility.refetch(), tokens.refetch()]),
  };
}

export function useDirectoryToken(uuid: string | undefined) {
  const apiClient = useApiClient();
  const token = useQuery({
    queryKey: [...DIRECTORY_QUERY_KEY, 'token', uuid],
    queryFn: () => getDirectoryToken(apiClient, uuid!),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const operator = useQuery({
    queryKey: OPERATOR_QUERY_KEY,
    queryFn: () => getOperator(apiClient),
    enabled: token.isSuccess,
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const notFound = failureStatus(token.error) === 404;

  return {
    token: token.data?.data ?? null,
    operator: operator.data?.data ?? null,
    isLoading: token.isLoading,
    notFound,
    hasError: token.isError && !notFound,
    isRefreshing: token.isFetching,
    retry: () => token.refetch(),
    operatorLoading: operator.isLoading,
    operatorFailed: operator.isError,
    operatorRefreshing: operator.isFetching,
    retryOperator: () => operator.refetch(),
  };
}

export function useDirectoryDocuments(uuid: string | undefined, enabled: boolean) {
  const apiClient = useApiClient();
  const documents = useQuery({
    queryKey: [...DIRECTORY_QUERY_KEY, 'token', uuid, 'documents'],
    queryFn: () => getDirectoryDocuments(apiClient, uuid!).then(({ data }) => data),
    enabled: !!uuid && enabled,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    documents: documents.data ?? [],
    isLoading: documents.isLoading,
    hasError: documents.isError,
    isRefreshing: documents.isFetching,
    retry: () => documents.refetch(),
  };
}
