import { useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, NavigatorScreenParams } from '@react-navigation/native';
import { clearLastNotificationResponse, useLastNotificationResponse } from 'expo-notifications';
import { XIcon } from 'phosphor-react-native';
import { formatDateTime, useNotifications } from '@ledova/shared';
import type { Notification } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { AnchoredPanel, type Anchor } from '../AnchoredPanel';
import { Action, Actions } from '../Ledger';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';

type Destination = NavigatorScreenParams<SignedInStackParamList>;

export function destinationOf(value: unknown): Destination | undefined {
  const data = (value ?? {}) as Record<string, unknown>;
  const { record, award, token } = data;
  switch (data.type) {
    case 'award':
      return typeof record === 'string' && typeof award === 'string'
        ? { screen: 'Dashboard', params: { record, award }, pop: true }
        : undefined;
    case 'holding':
      return typeof record === 'string' && typeof token === 'string'
        ? { screen: 'Certificates', params: { record, token } }
        : undefined;
    default:
      return undefined;
  }
}

export function useFollowPush(onFollow: () => void) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const response = useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    clearLastNotificationResponse();
    const destination = destinationOf(response.notification.request.content.data);
    if (!destination) return;
    onFollow();
    navigation.navigate('MainApp', destination);
  }, [response, navigation, onFollow]);
}

function usePanelStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.sm, lineHeight: 20 };
    const small = { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.xs, lineHeight: 16 };
    return {
      header: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.subtle,
      },
      heading: { ...text, flexShrink: 1, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      markAll: { ...small, color: theme.colors.brand.light },
      busy: { opacity: 0.5 },
      list: { maxHeight: 384 },
      status: { gap: 12, paddingHorizontal: theme.spacing.md, paddingVertical: 20 },
      more: { paddingHorizontal: theme.spacing.md, paddingVertical: 12 },
      loading: { ...text, color: theme.colors.text.muted },
      failure: { ...text, color: theme.colors.text.primary },
      empty: {
        ...text,
        textAlign: 'center' as const,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xl,
        color: theme.colors.text.muted,
      },
      rule: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
      item: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 12,
        paddingVertical: 12,
        paddingLeft: theme.spacing.md,
        paddingRight: 44,
      },
      dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
      unread: { backgroundColor: theme.colors.brand.mid },
      words: { flex: 1, minWidth: 0 },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      body: { ...small, marginTop: 2, color: theme.colors.text.muted },
      time: { ...small, marginTop: theme.spacing.xs, color: theme.colors.text.subtle },
      dismiss: { position: 'absolute' as const, top: 12, right: 12, padding: theme.spacing.xs },
    };
  });
}

function Failure({ retry, busy, children }: { retry: () => unknown; busy: boolean; children: string }) {
  const styles = usePanelStyles();
  return (
    <View style={styles.status}>
      <Text accessibilityRole="alert" style={styles.failure}>
        {children}
      </Text>
      <Actions>
        <Action label="Try again" disabled={busy} onPress={() => void retry()} />
      </Actions>
    </View>
  );
}

function NotificationItem({
  notification,
  ruled,
  onRead,
  onArchive,
  onFollow,
}: {
  notification: Notification;
  ruled: boolean;
  onRead: (uuid: string) => void;
  onArchive: (uuid: string) => void;
  onFollow: (notification: Notification) => void;
}) {
  const theme = useAppTheme();
  const styles = usePanelStyles();
  return (
    <View style={ruled && styles.rule}>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.item}
        onPress={() => {
          if (!notification.isRead) onRead(notification.uuid);
          onFollow(notification);
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.dot, !notification.isRead && styles.unread]} />
        <View style={styles.words}>
          <Text style={styles.title} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {notification.body}
          </Text>
          <Text style={styles.time}>{formatDateTime(notification.createdAt)}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${notification.title}`}
        style={styles.dismiss}
        onPress={() => onArchive(notification.uuid)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <XIcon size={16} color={theme.colors.text.subtle} />
      </TouchableOpacity>
    </View>
  );
}

export function NotificationsPanel({ anchor, onClose }: { anchor: Anchor | null; onClose: () => void }) {
  const styles = usePanelStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const {
    unreadCount,
    notifications,
    isLoadingNotifications,
    notificationsFailed,
    fetchNotifications,
    refreshUnreadCount,
    markAsRead,
    archive,
    markAllAsRead,
    isMarkingAllRead,
    hasMoreNotifications,
    isLoadingMoreNotifications,
    moreNotificationsFailed,
    loadMoreNotifications,
  } = useNotifications();
  const open = !!anchor;
  const load = useCallback(() => {
    void refreshUnreadCount();
    return fetchNotifications();
  }, [fetchNotifications, refreshUnreadCount]);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  const follow = (notification: Notification) => {
    const destination = destinationOf(notification.data);
    if (!destination) return;
    onClose();
    navigation.navigate('MainApp', destination);
  };
  const more = hasMoreNotifications || moreNotificationsFailed;

  return (
    <AnchoredPanel anchor={anchor} closeLabel="Close notifications" onClose={onClose}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: isMarkingAllRead }}
            disabled={isMarkingAllRead}
            onPress={() => markAllAsRead()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.markAll, isMarkingAllRead && styles.busy]}>Mark all as read</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView style={styles.list}>
        {isLoadingNotifications && notifications.length === 0 ? (
          <View style={styles.status}>
            <Text style={styles.loading}>Loading your notifications…</Text>
          </View>
        ) : notificationsFailed && notifications.length === 0 ? (
          <Failure retry={load} busy={isLoadingNotifications}>
            Your notifications could not be loaded.
          </Failure>
        ) : notifications.length === 0 ? (
          <Text style={styles.empty}>No notifications yet.</Text>
        ) : (
          <>
            {notificationsFailed && (
              <Failure retry={load} busy={isLoadingNotifications}>
                Your notifications could not be refreshed.
              </Failure>
            )}
            {notifications.map((notification: Notification, index) => (
              <NotificationItem
                key={notification.uuid}
                notification={notification}
                ruled={more || index < notifications.length - 1}
                onRead={markAsRead}
                onArchive={archive}
                onFollow={follow}
              />
            ))}
            {more &&
              (moreNotificationsFailed ? (
                <Failure retry={loadMoreNotifications} busy={isLoadingNotifications}>
                  More notifications could not be loaded. The list is incomplete.
                </Failure>
              ) : (
                <View style={styles.more}>
                  <Action
                    label={isLoadingMoreNotifications ? 'Loading notifications…' : 'Load more notifications'}
                    disabled={isLoadingNotifications || isLoadingMoreNotifications}
                    onPress={() => void loadMoreNotifications()}
                  />
                </View>
              ))}
          </>
        )}
      </ScrollView>
    </AnchoredPanel>
  );
}
