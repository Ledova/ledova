import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getDirectoryToken, getDirectoryTokens } from '../services/directory';
import { getInvestorEligibility } from '../services/investorClassifications';
import { getOperator } from '../services/operator';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export function useDirectoryTokens() {
  const apiClient = useApiClient();
  const eligibility = useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorEligibility(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const tokens = useQuery({
    queryKey: ['directory', 'tokens', 'complete'],
    queryFn: () => readEveryPage((page) => getDirectoryTokens(apiClient, page)),
    enabled: eligibility.data?.data?.isEligible === true && !eligibility.isError,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    tokens: tokens.data ?? [],
    isEligible: eligibility.data?.data?.isEligible ?? false,
    isLoading: tokens.isLoading || eligibility.isLoading,
    hasError: eligibility.isError || (eligibility.data?.data?.isEligible === true && tokens.isError),
    isRefreshing: tokens.isFetching || eligibility.isFetching,
    retry: () =>
      Promise.all([eligibility.refetch(), ...(eligibility.data?.data?.isEligible ? [tokens.refetch()] : [])]),
  };
}

export function useDirectoryToken(uuid: string | undefined) {
  const apiClient = useApiClient();
  const token = useQuery({
    queryKey: ['directory', 'token', uuid],
    queryFn: () => getDirectoryToken(apiClient, uuid!),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const operator = useQuery({
    queryKey: ['operator'],
    queryFn: () => getOperator(apiClient),
    enabled: token.isSuccess,
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const notFound = (token.error as { response?: { status?: number } } | null)?.response?.status === 404;

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
