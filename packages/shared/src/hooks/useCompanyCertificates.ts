import { useInfiniteQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterEntries } from '../services/register-corrections';
import { CERTIFICATE_STATUSES, type CertificateStatus } from '../utils/certificateRecords';
import { assertNextPageAdvances, getNextPageParam } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useClassRegister } from './useClassRegister';
import { registerKey } from './useCompanyOwnership';
import { useLaterPages } from './useLaterPages';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export type CertificateFilterValues = { search: string; status: CertificateStatus };

export function useCompanyCertificates(
  owner: OrderSubmissionOwner,
  currentOwner: () => OrderSubmissionOwner | null,
  company: string,
  requested: string | null,
  filters: CertificateFilterValues,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const source = useClassRegister(owner, currentOwner, company, requested, 'certificate', session);
  const { token, guard, register } = source;
  const queryKey = [...registerKey(owner), 'entries', token, 'certificates', filters.search, filters.status];
  const history = useInfiniteQuery({
    queryKey,
    enabled: source.ready && CERTIFICATE_STATUSES.some(([value]) => value === filters.status),
    queryFn: async ({ pageParam }) => {
      guard();
      const { data } = await getRegisterEntries(
        apiClient,
        token,
        {
          page: pageParam,
          search: filters.search || undefined,
          certificate_status: filters.status,
        },
        { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
      );
      guard();
      assertNextPageAdvances(pageParam, data);
      if (data.results.some((entry) => entry.changes.some((change) => !/^-?\d+$/.test(change.shares))))
        throw new Error('The certificate records did not state exact share quantities.');
      return data;
    },
    initialPageParam: 1,
    getNextPageParam,
    ...READ_TIMING,
  });
  const pages = useLaterPages(queryKey, history);
  const ready =
    source.ready && !history.isPending && !pages.hasError && (!history.isFetching || history.isFetchingNextPage);
  return {
    options: source.options,
    token,
    guard,
    register: ready ? register.data : undefined,
    entries: ready
      ? [
          ...new Map(
            (history.data?.pages ?? []).flatMap((page) => page.results).map((entry) => [entry.uuid, entry]),
          ).values(),
        ]
      : [],
    ready,
    sourceReady: source.sourceReady,
    hasError: source.hasError || pages.hasError,
    isRefreshing: source.isRefreshing || history.isFetching,
    retry: async () => {
      await source.retry();
      if (token) await history.refetch({ throwOnError: true });
    },
    more: {
      hasMore: history.hasNextPage,
      failed: pages.moreFailed,
      loading: history.isFetchingNextPage,
      onLoad: pages.loadMore,
    },
  };
}
