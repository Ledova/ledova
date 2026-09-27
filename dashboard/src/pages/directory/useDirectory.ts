import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  getDirectoryToken,
  getDirectoryTokens,
  getInvestorEligibility,
  getNextPageParam,
  getOperator,
  type DirectoryToken,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useDirectoryTokens() {
  const eligibility = useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorEligibility(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const tokens = useQuery({
    queryKey: ['directory', 'tokens', 'complete'],
    queryFn: async () => {
      const all: DirectoryToken[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const { data } = await getDirectoryTokens(apiClient, page);
        all.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Directory pagination did not advance');
        }
        page = next;
      }
      return all;
    },
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
