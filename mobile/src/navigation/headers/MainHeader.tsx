import { useEffect, useState } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { BellIcon } from 'phosphor-react-native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts';
import {
  AppMenu,
  AppearanceButton,
  MenuButton,
  SECTION_ROUTES,
  Wordmark,
  type Section,
  type SectionRoute,
} from '../AppMenu';

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
  current,
  onNotifications,
  unreadCount,
}: {
  navigation: NavigationProp<Record<SectionRoute, undefined>>;
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
        <View style={{ flex: 1, minWidth: 0 }}>
          <Wordmark />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppearanceButton />
          <NotificationsButton onPress={onNotifications} unreadCount={unreadCount} />
        </View>
      </View>
      <AppMenu
        visible={open}
        current={current}
        onClose={() => setOpen(false)}
        onSelect={(section) => {
          setOpen(false);
          const target = SECTION_ROUTES[section];
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
