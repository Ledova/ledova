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
  useCompanyOfferings,
  companyOfferingsKey,
  submitOffering,
  withdrawOffering,
  type OfferingListItem,
  type CompanyShareTokenListItem,
  type IssuerSubscriptionQueryParams,
  OPERATOR_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { PAGE_SIZE, keepWithin, retryUnlessGone, type ListParams } from '@hooks/useListParams';
import type { CompanyActionRead } from '@pages/company/shared/CompanyState';
import { useTokensList, companyTokensKey } from '@pages/company/shared/useTokensList';

type OfferingAction = 'submit' | 'withdraw' | 'remove' | 'edit' | 'documents';

export function companyOfferingKey(companyUuid: string | undefined, scopeKey: string) {
  return ['offering', companyUuid, scopeKey];
}

export function companyOfferingSubscriptionsKey(companyUuid: string | undefined, scopeKey: string) {
  return ['offering-subscriptions', companyUuid, scopeKey];
}

export function companyOfferingDetailKey(companyUuid: string | undefined, scopeKey: string, uuid: string | undefined) {
  return [...companyOfferingKey(companyUuid, scopeKey), uuid];
}

export function companyOfferingSubscriptionsDetailKey(
  companyUuid: string | undefined,
  scopeKey: string,
  uuid: string | undefined,
) {
  return [...companyOfferingSubscriptionsKey(companyUuid, scopeKey), uuid];
}

export function useOfferings(companyUuid: string | undefined, read: CompanyActionRead) {
  const client = useQueryClient();
  const offeringsKey = companyOfferingsKey(companyUuid, read.scopeKey);
  const tokensKey = companyTokensKey(companyUuid, read.scopeKey);
  const operatorKey = [...OPERATOR_QUERY_KEY, 'company', companyUuid, read.scopeKey];
  const guard = () => read.assertCurrent(companyUuid!, 'owner');
  const offeringsQuery = useCompanyOfferings(
    companyUuid,
    read.scopeKey,
    !!companyUuid && !read.error && !read.isRefreshing,
    async (load) => {
      guard();
      const result = await load();
      guard();
      return result;
    },
  );
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
        client.invalidateQueries({ queryKey: companyOfferingKey(companyUuid, read.scopeKey) }),
        client.invalidateQueries({ queryKey: companyOfferingSubscriptionsKey(companyUuid, read.scopeKey) }),
      ]),
  };
}

export function useCompanyOffering(uuid: string | undefined, companyUuid: string, read: CompanyActionRead) {
  return useQuery({
    queryKey: companyOfferingDetailKey(companyUuid, read.scopeKey, uuid),
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
  list: ListParams<'status'>,
) {
  const key = companyOfferingSubscriptionsDetailKey(companyUuid, read.scopeKey, uuid);
  return useQuery({
    queryKey: [...key, list.search, list.filters.status, list.page],
    enabled: !!uuid && !read.error && !read.isRefreshing,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    placeholderData: keepWithin(key),
    retry: retryUnlessGone,
    queryFn: async () => {
      read.assertCurrent(companyUuid, 'owner');
      const { data } = await getOfferingSubscriptions(apiClient, uuid!, list.page, {
        page_size: PAGE_SIZE,
        search: list.search || undefined,
        status: (list.filters.status || undefined) as IssuerSubscriptionQueryParams['status'],
      });
      read.assertCurrent(companyUuid, 'owner');
      return data;
    },
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
