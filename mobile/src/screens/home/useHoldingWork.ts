import { useSyncExternalStore } from 'react';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  USER_PREFERENCES_QUERY_KEY,
  getNextPageParam,
  getSubscriptions,
  useAuth,
  usePublicationSummary,
  useUserPreferences,
  type Subscription,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

export function useHoldingWork() {
  const auth = useAuth();
  const preferences = useUserPreferences();
  const checkingAccount = useIsFetching({ queryKey: USER_PREFERENCES_QUERY_KEY }) > 0 || auth.isFetching;
  const notices = usePublicationSummary();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const account = preferences.userAccount;
  const known =
    !preferences.isLoading &&
    !preferences.isError &&
    !!account?.uuid &&
    ['investor', 'company', 'both'].includes(account.role);
  const investing = known && (account?.role === 'investor' || account?.role === 'both');
  const applications = useQuery({
    queryKey: ['subscriptions', 'holdings-work', account?.uuid, epoch],
    enabled: investing,
    queryFn: async () => {
      const all: Subscription[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        assertSessionEpoch(epoch);
        const { data } = await getSubscriptions(apiClient, page);
        assertSessionEpoch(epoch);
        all.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Application pagination did not advance');
        }
        page = next;
      }
      return all;
    },
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const retryAccount = () => (auth.isAuthenticated ? preferences.refetch() : auth.refetch());

  return {
    known,
    investing,
    accountUnavailable: !auth.isLoading && !preferences.isLoading && !known,
    checkingAccount,
    retryAccount,
    applications,
    notices,
    isRefreshing: applications.isFetching || notices.isFetching || checkingAccount,
    refresh: () =>
      Promise.all([notices.retry(), known ? (investing ? applications.refetch() : Promise.resolve()) : retryAccount()]),
  };
}
