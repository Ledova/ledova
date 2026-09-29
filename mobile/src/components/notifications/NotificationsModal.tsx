import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { XIcon } from 'phosphor-react-native';
import { formatDateTime, PUBLICATION_NOTICE } from '@ledova/shared';
import type { Notification } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { Action, Rows } from '../Ledger';
import { CustomModal, useDialogStyles } from '../modal';
import { useNotifications } from '@ledova/shared';
import type { RootStackParamList } from '../../navigation/AppNavigator';

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
}

const DESTINATIONS: Record<string, string> = { [PUBLICATION_NOTICE]: 'Publications' };

export function destinationOf(notification: Notification): string | undefined {
  const type = (notification.data as { type?: unknown } | null | undefined)?.type;
  return typeof type === 'string' ? DESTINATIONS[type] : undefined;
}

function NotificationItem({
  notification,
  onRead,
  onArchive,
  onFollow,
}: {
  notification: Notification;
  onRead: (uuid: string) => void;
  onArchive: (uuid: string) => void;
  onFollow: (notification: Notification) => void;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    notificationItem: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      paddingVertical: theme.spacing.sm,
    },
    notificationContent: {
      flex: 1,
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.sm,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.interactive.active,
      marginTop: 6,
    },
    textContainer: {
      flex: 1,
    },
    textContainerRead: {
      paddingLeft: 16,
    },
    notificationTitle: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    notificationBody: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
      marginTop: 2,
    },
    notificationTime: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
      marginTop: 4,
    },
    archiveButton: {
      padding: theme.spacing.xs,
      marginLeft: theme.spacing.xs,
    },
  }));
  return (
    <TouchableOpacity
      style={styles.notificationItem}
      onPress={() => {
        if (!notification.isRead) onRead(notification.uuid);
        onFollow(notification);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.notificationContent}>
        {!notification.isRead && <View style={styles.unreadDot} />}
        <View style={[styles.textContainer, notification.isRead && styles.textContainerRead]}>
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notificationBody} numberOfLines={2}>
            {notification.body}
          </Text>
          <Text style={styles.notificationTime}>{formatDateTime(notification.createdAt)}</Text>
        </View>
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${notification.title}`}
        style={styles.archiveButton}
        onPress={() => onArchive(notification.uuid)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <XIcon size={16} color={theme.colors.text.muted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function NotificationsModal({ visible, onClose }: NotificationsModalProps) {
  const theme = useAppTheme();
  const styles = useDialogStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const {
    unreadCount,
    notifications,
    isLoadingNotifications,
    fetchNotifications,
    markAsRead,
    archive,
    markAllAsRead,
    isMarkingAllRead,
  } = useNotifications();

  useEffect(() => {
    if (visible) {
      fetchNotifications();
    }
  }, [visible, fetchNotifications]);

  const follow = (notification: Notification) => {
    const destination = destinationOf(notification);
    if (!destination) return;
    onClose();
    navigation.navigate('MainApp', { screen: 'Main', params: { screen: destination } } as never);
  };

  return (
    <CustomModal
      visible={visible}
      title="Notifications"
      onClose={onClose}
      showFooter
      cancelLabel="Close"
      actions={
        unreadCount > 0 ? (
          <Action label="Mark all as read" onPress={() => markAllAsRead()} disabled={isMarkingAllRead} />
        ) : undefined
      }
    >
      {isLoadingNotifications && notifications.length === 0 ? (
        <ActivityIndicator size="small" color={theme.colors.interactive.active} />
      ) : notifications.length === 0 ? (
        <Text style={styles.muted}>No notifications yet</Text>
      ) : (
        <Rows>
          {notifications.map((notification: Notification) => (
            <NotificationItem
              key={notification.uuid}
              notification={notification}
              onRead={markAsRead}
              onArchive={archive}
              onFollow={follow}
            />
          ))}
        </Rows>
      )}
    </CustomModal>
  );
}
