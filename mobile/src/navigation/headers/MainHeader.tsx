import { useEffect, useState, type ReactNode } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { BellIcon } from 'phosphor-react-native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts';
import { AppMenu, MenuButton, type MenuRoute, type Section } from '../AppMenu';

function NotificationsButton({ onPress, unreadCount = 0 }: { onPress: () => void; unreadCount?: number }) {
  const theme = useAppTheme();
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${badgeText} unread` : 'Notifications'}
      onPress={onPress}
      hitSlop={2}
      style={{
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <BellIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} weight={theme.icon.weights.regular} />
      {unreadCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.error.default,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: 'bold',
              color: theme.colors.utility.white,
            }}
          >
            {badgeText}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function TopBar({
  navigation,
  route,
  title,
  action,
  current,
  onNotifications,
  unreadCount,
}: {
  navigation: NavigationProp<Record<MenuRoute, undefined>>;
  route: string;
  title: string | undefined;
  action: ReactNode;
  current: Section;
  onNotifications: () => void;
  unreadCount: number;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  useEffect(() => navigation.addListener('blur', () => setOpen(false)), [navigation]);
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.colors.surface.base,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.subtle,
      }}
    >
      <View
        style={{
          height: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
        }}
      >
        <MenuButton expanded={open} onPress={() => setOpen(true)} />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: theme.fontFamily.display,
            fontSize: theme.fontSize.xl,
            lineHeight: 28,
            letterSpacing: -0.2,
            color: theme.colors.text.primary,
          }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {action}
          <NotificationsButton onPress={onNotifications} unreadCount={unreadCount} />
        </View>
      </View>
      <AppMenu
        visible={open}
        current={current}
        route={route}
        onClose={() => setOpen(false)}
        onSelect={(target) => {
          setOpen(false);
          navigation.reset(
            target === 'Dashboard'
              ? { index: 0, routes: [{ name: 'Dashboard' }] }
              : { index: 1, routes: [{ name: 'Dashboard' }, { name: target }] },
          );
        }}
      />
    </View>
  );
}
