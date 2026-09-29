import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  deleteOffering,
  getCompanyTokens,
  getOperator,
  getOfferings,
  readEveryPage,
  submitOffering,
  withdrawOffering,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';

export function useOfferings(companyUuid?: string) {
  const client = useQueryClient();
  const offeringsQuery = useQuery({
    queryKey: ['offerings', companyUuid],
    queryFn: () => readEveryPage((page) => getOfferings(apiClient, page)),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokensQuery = useQuery({
    queryKey: ['company-tokens', 'company', companyUuid],
    queryFn: async () =>
      (await readEveryPage((page) => getCompanyTokens(apiClient, { page }))).filter(
        (token) => token.companyUuid === companyUuid,
      ),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
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

export function useOfferingActions(onSettled: () => Promise<unknown>) {
  const onSuccess = async (_: unknown, { epoch }: { epoch: number }) => {
    assertSessionEpoch(epoch);
    await onSettled();
    assertSessionEpoch(epoch);
  };
  const submit = useMutation({
    mutationFn: async ({ uuid, epoch }: { uuid: string; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await submitOffering(apiClient, uuid, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess,
  });
  const withdraw = useMutation({
    mutationFn: async ({ uuid, reason, epoch }: { uuid: string; reason: string; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await withdrawOffering(apiClient, uuid, reason, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: async ({ uuid, epoch }: { uuid: string; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await deleteOffering(apiClient, uuid, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess,
  });
  return { submit, withdraw, remove };
}
