import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  assertNextPageAdvances,
  getCompanyTokenHolders,
  getNextPageParam,
  getRegisterEntries,
  hasCurrentRegisterReadAuthority,
  useLaterPages,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  CERTIFICATE_STATUSES,
  type CertificateStatus,
  type MemberCertificateRequest,
} from '@ledova/shared';
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { registerClassesKey, registerHoldersKey, useRegisterClasses } from '@hooks/useRegisterClasses';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import apiClient from '@services/apiClient';

type RegisterClass = NonNullable<ReturnType<typeof useRegisterClasses>['data']>[number];

export type CertificateFilterValues = { search: string; status: CertificateStatus };

export function useCompanyCertificates(
  owner: OrderSubmissionOwner,
  currentOwner: () => OrderSubmissionOwner | null,
  company: string,
  requested: string | null,
  preferred: string,
  filters: CertificateFilterValues,
  association?: string,
  requests: readonly MemberCertificateRequest[] = [],
) {
  const client = useQueryClient();
  const accountGuard = useMemo(
    () => () => {
      const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
      if (currentOwner() !== owner || preferences?.status !== 'success' || preferences.fetchStatus !== 'idle')
        throw new Error('Your signed-in account changed. Reopen Certificates.');
    },
    [client, currentOwner, owner],
  );
  const appointments = useOwnAppointments(owner, accountGuard);
  const classes = useRegisterClasses(owner, accountGuard);
  const options = classes.data?.filter((item) => item.companyUuid === company) ?? [];
  const token = useMemo(
    () =>
      requested ??
      (classes.data?.some((item) => item.companyUuid === company && item.uuid === preferred)
        ? preferred
        : (classes.data?.find((item) => item.companyUuid === company)?.uuid ?? '')),
    [classes.data, company, preferred, requested],
  );
  const guard = useMemo(
    () => () => {
      accountGuard();
      const authority = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      const source = client.getQueryState<RegisterClass[]>(registerClassesKey(owner));
      if (
        authority?.status !== 'success' ||
        authority.fetchStatus !== 'idle' ||
        !hasCurrentRegisterReadAuthority(authority.data ?? [], company) ||
        source?.status !== 'success' ||
        source.fetchStatus !== 'idle' ||
        !source.data?.some((item) => item.uuid === token && item.companyUuid === company)
      )
        throw new Error('Your current company and share class access could not be confirmed.');
    },
    [accountGuard, client, company, owner, token],
  );
  const sourceReady =
    classes.isSuccess &&
    !classes.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const register = useQuery({
    queryKey: [...registerHoldersKey(owner), 'certificate', token],
    enabled: sourceReady && options.some((item) => item.uuid === token),
    queryFn: async () => {
      guard();
      const { data } = await getCompanyTokenHolders(apiClient, token, { ledovaSubmissionGuard: guard });
      guard();
      if (data.token.uuid !== token) throw new Error('The register returned another share class.');
      return data;
    },
    ...READ_TIMING,
  });
  const requestVersion =
    filters.status === 'all'
      ? ''
      : JSON.stringify(
          requests
            .filter((item) => item.token === token)
            .map((item) => [item.uuid, item.status, item.createdAt])
            .sort((left, right) => left[0]!.localeCompare(right[0]!)),
        );
  const queryKey = [
    ...registerKey(owner),
    'entries',
    token,
    'certificates',
    filters.search,
    filters.status,
    association ?? '',
    requestVersion,
  ];
  const history = useInfiniteQuery({
    queryKey,
    enabled:
      sourceReady &&
      register.isSuccess &&
      !register.isFetching &&
      CERTIFICATE_STATUSES.some(([value]) => value === filters.status),
    queryFn: async ({ pageParam }) => {
      guard();
      const { data } = await getRegisterEntries(
        apiClient,
        token,
        {
          page: pageParam,
          search: filters.search || undefined,
          certificate_status: filters.status,
          ...(association ? { association } : {}),
        },
        { ledovaSubmissionGuard: guard },
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
    sourceReady &&
    register.isSuccess &&
    !register.isFetching &&
    !history.isPending &&
    !pages.hasError &&
    (!history.isFetching || history.isFetchingNextPage);
  return {
    options: sourceReady ? options : [],
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
    sourceReady,
    hasError: classes.isError || appointments.isError || register.isError || pages.hasError,
    isRefreshing: classes.isFetching || appointments.isFetching || register.isFetching || history.isFetching,
    retry: async () => {
      await appointments.refetch({ throwOnError: true });
      await classes.refetch({ throwOnError: true });
      guard();
      if (token) {
        await register.refetch({ throwOnError: true });
        await history.refetch({ throwOnError: true });
      }
    },
    more: {
      hasMore: history.hasNextPage,
      failed: pages.moreFailed,
      loading: history.isFetchingNextPage,
      onLoad: pages.loadMore,
    },
  };
}
