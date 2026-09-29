import { useSyncExternalStore } from 'react';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  USER_PREFERENCES_QUERY_KEY,
  canOpen,
  getPublications,
  getSubscriptions,
  readEveryPage,
  useAuth,
  usePublicationSummary,
  useUserPreferences,
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
  const investing = known && !!account && canOpen(account.role, 'investing');
  const applications = useQuery({
    queryKey: ['subscriptions', 'holdings-work', account?.uuid, epoch],
    enabled: investing,
    queryFn: () =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getSubscriptions(apiClient, page);
        assertSessionEpoch(epoch);
        return response;
      }),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const recent = useQuery({
    queryKey: ['publications', 'addressed', 'me', 'latest', epoch],
    queryFn: async () => {
      assertSessionEpoch(epoch);
      const { data } = await getPublications(apiClient, 1, { addressed: 'me' });
      assertSessionEpoch(epoch);
      return data.results.slice(0, 3);
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
    recent,
    isRefreshing: applications.isFetching || notices.isFetching || recent.isFetching || checkingAccount,
    refresh: () =>
      Promise.all([
        notices.retry(),
        recent.refetch(),
        known ? (investing ? applications.refetch() : Promise.resolve()) : retryAccount(),
      ]),
  };
}
