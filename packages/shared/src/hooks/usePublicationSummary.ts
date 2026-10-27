import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { getPublicationSummary } from '../services/publications';
import { useApiClient } from './useApiClient';

export const PUBLICATIONS_QUERY_KEY = ['publications'] as const;
const PUBLICATION_SUMMARY_QUERY_KEY = [...PUBLICATIONS_QUERY_KEY, 'summary'] as const;

export function usePublicationSummary() {
  const apiClient = useApiClient();
  const summary = useQuery({
    queryKey: PUBLICATION_SUMMARY_QUERY_KEY,
    queryFn: async () => (await getPublicationSummary(apiClient)).data,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  return {
    summary: summary.data,
    isPending: summary.isPending,
    isError: summary.isError,
    isFetching: summary.isFetching,
    retry: summary.refetch,
  };
}
