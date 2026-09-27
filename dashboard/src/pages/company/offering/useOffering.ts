import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  deleteOffering,
  getNextPageParam,
  getOperator,
  getOffering,
  getOfferings,
  getOfferingSubscriptions,
  submitOffering,
  withdrawOffering,
  type PaginatedResponse,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useTokensList } from '../hooks/useTokens';

async function everyPage<T>(read: (page: number) => Promise<{ data: PaginatedResponse<T> }>) {
  const rows: T[] = [];
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await read(page);
    rows.push(...data.results);
    const next = getNextPageParam(data);
    if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
      throw new Error('Offering pagination did not advance');
    }
    page = next;
  }
  return rows;
}

export function useOfferings(companyUuid?: string) {
  const client = useQueryClient();
  const offeringsQuery = useQuery({
    queryKey: ['offerings', companyUuid],
    queryFn: () => everyPage((page) => getOfferings(apiClient, page)),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokensQuery = useTokensList(companyUuid);
  const operatorQuery = useQuery({
    queryKey: ['operator'],
    queryFn: () => getOperator(apiClient),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokenIds = new Set(tokensQuery.data?.map((token) => token.uuid));
  return {
    offerings: (offeringsQuery.data ?? []).filter((offering) => tokenIds.has(offering.tokenUuid)),
    tokens: tokensQuery.data ?? [],
    settlementAssets: operatorQuery.data?.data.supportedSettlementAssets ?? [],
    operatorName: operatorQuery.isError ? 'the operator' : operatorQuery.data?.data.name || 'the operator',
    isLoading: offeringsQuery.isLoading || tokensQuery.isLoading || operatorQuery.isLoading,
    isRefreshing: offeringsQuery.isFetching || tokensQuery.isFetching || operatorQuery.isFetching,
    error: offeringsQuery.error || tokensQuery.error || operatorQuery.error,
    refetch: () => Promise.all([offeringsQuery.refetch(), tokensQuery.refetch(), operatorQuery.refetch()]),
    refresh: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['offerings'] }),
        client.invalidateQueries({ queryKey: ['offering'] }),
        client.invalidateQueries({ queryKey: ['offering-subscriptions'] }),
      ]),
  };
}

export function useOfferingSubscriptions(uuid?: string) {
  return useQuery({
    queryKey: ['offering-subscriptions', uuid],
    queryFn: () => everyPage((page) => getOfferingSubscriptions(apiClient, uuid!, page)),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}

export function useOfferingUnderEdit(uuid?: string) {
  return useQuery({
    queryKey: ['offering', uuid],
    queryFn: async () => (await getOffering(apiClient, uuid!)).data,
    enabled: !!uuid,
    staleTime: 0,
  });
}

export function useOfferingActions(onSettled: () => Promise<unknown>) {
  const submit = useMutation({ mutationFn: (uuid: string) => submitOffering(apiClient, uuid), onSuccess: onSettled });
  const withdraw = useMutation({
    mutationFn: ({ uuid, reason }: { uuid: string; reason: string }) => withdrawOffering(apiClient, uuid, reason),
    onSuccess: onSettled,
  });
  const remove = useMutation({ mutationFn: (uuid: string) => deleteOffering(apiClient, uuid), onSuccess: onSettled });
  return { submit, withdraw, remove };
}
