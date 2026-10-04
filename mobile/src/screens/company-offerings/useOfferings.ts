import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  deleteOffering,
  getCompanyTokens,
  getOperator,
  getOfferings,
  getOffering,
  readEveryPage,
  submitOffering,
  withdrawOffering,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import type { CompanyActionRead } from '../company/CompanyState';

export function useOfferings(read: CompanyActionRead) {
  const companyUuid = read.ownerBusiness ? read.companyUuid : undefined;
  const guard = () => read.assertCurrent(companyUuid!, 'owner');
  const readPage = async <T>(load: () => Promise<T>) => {
    guard();
    const response = await load();
    guard();
    return response;
  };
  const client = useQueryClient();
  const offeringsQuery = useQuery({
    queryKey: ['offerings', companyUuid, read.scopeKey],
    queryFn: () => readEveryPage((page) => readPage(() => getOfferings(apiClient, page))),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokensQuery = useQuery({
    queryKey: ['company-tokens', 'company', companyUuid, read.scopeKey],
    queryFn: async () =>
      (await readEveryPage((page) => readPage(() => getCompanyTokens(apiClient, { page })))).filter(
        (token) => token.companyUuid === companyUuid,
      ),
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const operatorQuery = useQuery({
    queryKey: ['operator', read.scopeKey],
    queryFn: () => readPage(() => getOperator(apiClient)),
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

export function useOwnedOffering(read: CompanyActionRead, uuid?: string) {
  return useQuery({
    queryKey: ['offering', uuid, read.scopeKey],
    enabled: !!uuid && read.ownerBusiness,
    staleTime: 0,
    queryFn: async () => {
      read.assertCurrent(read.companyUuid!, 'owner');
      const response = await getOffering(apiClient, uuid!);
      read.assertCurrent(read.companyUuid!, 'owner');
      if (response.data.uuid !== uuid) throw new Error('The offering detail could not be confirmed.');
      return response.data;
    },
  });
}

export function useOfferingActions(read: CompanyActionRead, onSettled: () => Promise<unknown>) {
  type Bound = { guard: () => void; config: ReturnType<typeof read.requestConfig> };
  const bind = (): Bound => ({
    guard: () => read.assertCurrent(read.companyUuid!, 'owner'),
    config: read.requestConfig(read.companyUuid!, 'owner'),
  });
  const onSuccess = async (_: unknown, { epoch, guard }: { epoch: number } & Bound) => {
    assertSessionEpoch(epoch);
    guard();
    await onSettled();
    assertSessionEpoch(epoch);
    guard();
  };
  const submit = useMutation({
    mutationFn: async ({ uuid, epoch, guard, config }: { uuid: string; epoch: number } & Bound) => {
      assertSessionEpoch(epoch);
      guard();
      const response = await submitOffering(apiClient, uuid, { ...config, ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      guard();
      return response;
    },
    onSuccess,
  });
  const withdraw = useMutation({
    mutationFn: async ({
      uuid,
      reason,
      epoch,
      guard,
      config,
    }: { uuid: string; reason: string; epoch: number } & Bound) => {
      assertSessionEpoch(epoch);
      guard();
      const response = await withdrawOffering(apiClient, uuid, reason, { ...config, ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      guard();
      return response;
    },
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: async ({ uuid, epoch, guard, config }: { uuid: string; epoch: number } & Bound) => {
      assertSessionEpoch(epoch);
      guard();
      const response = await deleteOffering(apiClient, uuid, { ...config, ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      guard();
      return response;
    },
    onSuccess,
  });
  return {
    submit: {
      ...submit,
      mutateAsync: (input: { uuid: string; epoch: number }) => submit.mutateAsync({ ...input, ...bind() }),
    },
    withdraw: {
      ...withdraw,
      mutateAsync: (input: { uuid: string; reason: string; epoch: number }) =>
        withdraw.mutateAsync({ ...input, ...bind() }),
    },
    remove: {
      ...remove,
      mutateAsync: (input: { uuid: string; epoch: number }) => remove.mutateAsync({ ...input, ...bind() }),
    },
  };
}
