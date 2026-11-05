import { useLayoutEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getCompanyTokenHolders } from '../services/company-tokens';
import type { CompanyShareTokenListItem, OwnCompanyAppointment } from '../types';
import { hasCurrentRegisterReadAuthority } from '../utils/register-commands';
import { useApiClient } from './useApiClient';
import { registerClassesKey, registerHoldersKey } from './useCompanyOwnership';
import { ownAppointmentsKey, useOwnAppointments } from './useOwnAppointments';
import { useRegisterClasses } from './useRegisterClasses';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';

const PAGES = { certificate: 'Certificates', inspection: 'Inspection copies' } as const;

export function useClassRegister(
  owner: OrderSubmissionOwner,
  currentOwner: () => OrderSubmissionOwner | null,
  company: string,
  requested: string | null,
  purpose: keyof typeof PAGES,
  session?: OrderSubmissionSession,
  available = true,
) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const accountGuard = useMemo(
    () => () => {
      const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
      if (currentOwner() !== owner || preferences?.status !== 'success' || preferences.fetchStatus !== 'idle')
        throw new Error(`Your signed-in account changed. Reopen ${PAGES[purpose]}.`);
    },
    [client, currentOwner, owner, purpose],
  );
  const sourceAvailable = useRef(available);
  useLayoutEffect(() => {
    sourceAvailable.current = available;
  }, [available]);
  const sourceGuard = useMemo(
    () => () => {
      accountGuard();
      if (!sourceAvailable.current) throw new Error('Your company access could not be confirmed.');
    },
    [accountGuard],
  );
  const appointments = useOwnAppointments(owner, accountGuard, { session });
  const classes = useRegisterClasses(owner, accountGuard, session, available);
  const options = classes.data?.filter((item) => item.companyUuid === company) ?? [];
  const token = useMemo(
    () => requested ?? classes.data?.find((item) => item.companyUuid === company)?.uuid ?? '',
    [classes.data, company, requested],
  );
  const guard = useMemo(
    () => () => {
      sourceGuard();
      const authority = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      const source = client.getQueryState<CompanyShareTokenListItem[]>(registerClassesKey(owner));
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
    [sourceGuard, client, company, owner, token],
  );
  const sourceReady =
    available &&
    classes.isSuccess &&
    !classes.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const register = useQuery({
    queryKey: [...registerHoldersKey(owner), purpose, token],
    enabled: sourceReady && options.some((item) => item.uuid === token),
    queryFn: async () => {
      guard();
      const { data } = await getCompanyTokenHolders(apiClient, token, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (data.token.uuid !== token) throw new Error('The register returned another share class.');
      return data;
    },
    ...READ_TIMING,
  });
  return {
    options: sourceReady ? options : [],
    token,
    guard,
    register,
    sourceReady,
    ready: sourceReady && options.some((item) => item.uuid === token) && register.isSuccess && !register.isFetching,
    hasError: classes.isError || appointments.isError || register.isError,
    isRefreshing: classes.isFetching || appointments.isFetching || register.isFetching,
    retry: async () => {
      await appointments.refetch({ throwOnError: true });
      await classes.refetch({ throwOnError: true });
      guard();
      if (token) await register.refetch({ throwOnError: true });
    },
  };
}
