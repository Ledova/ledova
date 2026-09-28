import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { LONGEST_TIMER_DELAY, PUBLICATION_SUMMARY_REFRESH_INTERVAL } from '../constants/business/publications';
import { getPublicationSummary } from '../services/publications';
import { useApiClient } from './useApiClient';

const PUBLICATION_SUMMARY_QUERY_KEY = ['publications', 'summary'] as const;

export function usePublicationSummary() {
  const apiClient = useApiClient();
  const summary = useQuery({
    queryKey: PUBLICATION_SUMMARY_QUERY_KEY,
    queryFn: async () => (await getPublicationSummary(apiClient)).data,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    refetchInterval: PUBLICATION_SUMMARY_REFRESH_INTERVAL,
  });
  const closes = summary.data?.nextClosesAt ?? null;
  const { refetch } = summary;

  useEffect(() => {
    if (closes === null) return undefined;
    const delay = Math.min(Math.max(Date.parse(closes) - Date.now(), 0), LONGEST_TIMER_DELAY);
    const timer = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(timer);
  }, [closes, refetch]);

  return {
    summary: summary.data,
    isPending: summary.isPending,
    isError: summary.isError,
    isFetching: summary.isFetching,
    retry: summary.refetch,
  };
}
