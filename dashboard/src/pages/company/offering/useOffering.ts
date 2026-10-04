import type { AxiosRequestConfig } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  OFFERING_PUBLISHED_STATUSES,
  OFFERING_WITHDRAWABLE_STATUSES,
  createUserFriendlyError,
  deleteOffering,
  getOperator,
  getOffering,
  getOfferingSubscriptions,
  getOfferings,
  readEveryPage,
  submitOffering,
  withdrawOffering,
  type OfferingListItem,
  type CompanyShareTokenListItem,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from '../CompanyState';
import { useTokensList } from '../hooks/useTokens';

type OfferingAction = 'submit' | 'withdraw' | 'remove' | 'edit' | 'documents';

export function useOfferings(companyUuid: string | undefined, read: CompanyActionRead) {
  const client = useQueryClient();
  const offeringsKey = ['offerings', companyUuid, read.scopeKey];
  const tokensKey = ['tokens', 'company', companyUuid, read.scopeKey];
  const operatorKey = ['operator', 'company', companyUuid, read.scopeKey];
  const guard = () => read.assertCurrent(companyUuid!, 'owner');
  const offeringsQuery = useQuery({
    queryKey: offeringsKey,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOfferings(apiClient, page);
        guard();
        return result;
      }),
    enabled: !!companyUuid && !read.error && !read.isRefreshing,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokensQuery = useTokensList(companyUuid, read);
  const operatorQuery = useQuery({
    queryKey: operatorKey,
    queryFn: async () => {
      guard();
      const result = await getOperator(apiClient);
      guard();
      return result;
    },
    enabled: !!companyUuid && !read.error && !read.isRefreshing,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const tokenIds = new Set(tokensQuery.data?.map((token) => token.uuid));
  const assertCurrent = () => {
    guard();
    for (const key of [offeringsKey, tokensKey, operatorKey]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh offering information before continuing.');
    }
  };
  return {
    offerings: (offeringsQuery.data ?? []).filter((offering) => tokenIds.has(offering.tokenUuid)),
    tokens: tokensQuery.data ?? [],
    settlementAssets: operatorQuery.data?.data.supportedSettlementAssets ?? [],
    operatorName: operatorQuery.isError ? 'the operator' : operatorQuery.data?.data.name || 'the operator',
    isLoading: offeringsQuery.isLoading || tokensQuery.isLoading || operatorQuery.isLoading,
    isRefreshing: offeringsQuery.isFetching || tokensQuery.isFetching || operatorQuery.isFetching,
    error: offeringsQuery.error || tokensQuery.error || operatorQuery.error,
    assertCurrent,
    assertOffering: (uuid: string, action: OfferingAction) => {
      assertCurrent();
      const tokens = client.getQueryData<CompanyShareTokenListItem[]>(tokensKey);
      const offering = client.getQueryData<OfferingListItem[]>(offeringsKey)?.find((item) => item.uuid === uuid);
      if (
        !offering ||
        !tokens?.some((token) => token.uuid === offering.tokenUuid && token.companyUuid === companyUuid) ||
        ((action === 'submit' || action === 'edit') && !offering.canBeEdited) ||
        (action === 'remove' && !offering.canBeDeleted) ||
        (action === 'withdraw' && !OFFERING_WITHDRAWABLE_STATUSES.includes(offering.status)) ||
        (action === 'documents' && !OFFERING_PUBLISHED_STATUSES.includes(offering.status))
      )
        throw createUserFriendlyError('This offering changed. Refresh before continuing.');
    },
    refetch: () => Promise.all([offeringsQuery.refetch(), tokensQuery.refetch(), operatorQuery.refetch()]),
    refresh: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: offeringsKey }),
        client.invalidateQueries({ queryKey: ['offering', companyUuid, read.scopeKey] }),
        client.invalidateQueries({ queryKey: ['offering-subscriptions', companyUuid, read.scopeKey] }),
      ]),
  };
}

export function useCompanyOffering(uuid: string | undefined, companyUuid: string, read: CompanyActionRead) {
  return useQuery({
    queryKey: ['offering', companyUuid, read.scopeKey, uuid],
    enabled: !!uuid && !read.error && !read.isRefreshing,
    staleTime: 0,
    queryFn: async () => {
      read.assertCurrent(companyUuid, 'owner');
      const { data } = await getOffering(apiClient, uuid!);
      read.assertCurrent(companyUuid, 'owner');
      if (data.uuid !== uuid) throw createUserFriendlyError('The offering could not be confirmed.');
      return data;
    },
  });
}

export function useCompanyOfferingSubscriptions(
  uuid: string | undefined,
  companyUuid: string,
  read: CompanyActionRead,
) {
  return useQuery({
    queryKey: ['offering-subscriptions', companyUuid, read.scopeKey, uuid],
    enabled: !!uuid && !read.error && !read.isRefreshing,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: () =>
      readEveryPage(async (page) => {
        read.assertCurrent(companyUuid, 'owner');
        const result = await getOfferingSubscriptions(apiClient, uuid!, page);
        read.assertCurrent(companyUuid, 'owner');
        return result;
      }),
  });
}

export function useOfferingActions(
  onSuccess: () => Promise<unknown>,
  requestConfig: (uuid: string, action: 'submit' | 'withdraw' | 'remove') => AxiosRequestConfig,
) {
  const run = async (uuid: string, action: 'submit' | 'withdraw' | 'remove', reason?: string) => {
    const config = requestConfig(uuid, action);
    config.ledovaSubmissionGuard?.();
    const result =
      action === 'submit'
        ? await submitOffering(apiClient, uuid, config)
        : action === 'withdraw'
          ? await withdrawOffering(apiClient, uuid, reason!, config)
          : await deleteOffering(apiClient, uuid, config);
    config.ledovaSubmissionGuard?.();
    return result;
  };
  const submit = useMutation({ mutationFn: (uuid: string) => run(uuid, 'submit'), onSuccess });
  const withdraw = useMutation({
    mutationFn: ({ uuid, reason }: { uuid: string; reason: string }) => run(uuid, 'withdraw', reason),
    onSuccess,
  });
  const remove = useMutation({ mutationFn: (uuid: string) => run(uuid, 'remove'), onSuccess });
  return { submit, withdraw, remove };
}
