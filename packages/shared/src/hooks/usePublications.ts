import { useInfiniteQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants';
import { getPublications, getPublicationsNextPage } from '../services/publications';
import { assertNextPageAdvances } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useLaterPages } from './useLaterPages';

export const PUBLICATIONS_QUERY_KEY = ['publications'] as const;
export const PERSONAL_NOTICES_QUERY_KEY = [...PUBLICATIONS_QUERY_KEY, 'addressed', 'me'];

export function usePublications() {
  const apiClient = useApiClient();
  const listing = useInfiniteQuery({
    queryKey: PERSONAL_NOTICES_QUERY_KEY,
    queryFn: async ({ pageParam }) => {
      const response = await getPublications(apiClient, pageParam, { addressed: 'me' });
      assertNextPageAdvances(pageParam, response.data);
      return response;
    },
    getNextPageParam: getPublicationsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const pages = useLaterPages(PERSONAL_NOTICES_QUERY_KEY, listing);
  return { listing, pages };
}
