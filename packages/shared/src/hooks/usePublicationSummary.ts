import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { getPublicationSummary } from '../services/publications';
import { describePublicationSummary } from '../utils/publications';
import { useApiClient } from './useApiClient';

export const PUBLICATION_SUMMARY_QUERY_KEY = ['publications', 'summary'] as const;

const NOTHING_TO_SAY: string[] = [];

export function usePublicationSummary() {
  const apiClient = useApiClient();
  const summary = useQuery({
    queryKey: PUBLICATION_SUMMARY_QUERY_KEY,
    queryFn: () => getPublicationSummary(apiClient),
    select: (response) => describePublicationSummary(response.data),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return { lines: summary.data ?? NOTHING_TO_SAY };
}
