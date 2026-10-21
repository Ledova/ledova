import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import {
  archiveNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications';
import { assertNextPageAdvances, getNextPageParam } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useLaterPages } from './useLaterPages';

const NOTIFICATIONS_LIST_KEY = ['notifications', 'list'];

export function useNotifications() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const unreadCountQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => getUnreadNotificationCount(apiClient),
    staleTime: CACHE_TIMING.VERY_SHORT_STALE_TIME,
    refetchInterval: 60 * 1000,
  });

  const notificationsQuery = useInfiniteQuery({
    queryKey: NOTIFICATIONS_LIST_KEY,
    queryFn: async ({ pageParam }) => {
      const { data } = await getNotifications(apiClient, pageParam);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.VERY_SHORT_STALE_TIME,
    enabled: false,
  });
  const pages = useLaterPages(NOTIFICATIONS_LIST_KEY, notificationsQuery);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    notificationsQuery.refetch();
  };

  const markReadMutation = useMutation({
    mutationFn: (uuid: string) => markNotificationRead(apiClient, uuid),
    onSuccess: refresh,
  });

  const archiveMutation = useMutation({
    mutationFn: (uuid: string) => archiveNotification(apiClient, uuid),
    onSuccess: refresh,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(apiClient),
    onSuccess: refresh,
  });

  return {
    unreadCount: unreadCountQuery.data?.data?.unreadCount ?? 0,
    notifications: [
      ...new Map(
        (notificationsQuery.data?.pages ?? []).flatMap((page) => page.results).map((item) => [item.uuid, item]),
      ).values(),
    ],
    isLoadingNotifications: notificationsQuery.isLoading || notificationsQuery.isFetching,
    notificationsFailed: pages.hasError,
    fetchNotifications: notificationsQuery.refetch,
    hasMoreNotifications: notificationsQuery.hasNextPage,
    isLoadingMoreNotifications: notificationsQuery.isFetchingNextPage,
    moreNotificationsFailed: pages.moreFailed,
    loadMoreNotifications: pages.loadMore,
    markAsRead: markReadMutation.mutate,
    archive: archiveMutation.mutate,
    markAllAsRead: markAllReadMutation.mutate,
    isMarkingAllRead: markAllReadMutation.isPending,
  };
}
