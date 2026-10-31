import React, { useEffect, useState } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { BellIcon } from 'phosphor-react-native';
import { Header } from '@react-navigation/elements';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts';
import { AppMenu, AppearanceButton, MenuButton, Wordmark, type Section } from '../AppMenu';

type ThemeParam = ReturnType<typeof useAppTheme>;

function NotificationsButton({ onPress, unreadCount = 0 }: { onPress: () => void; unreadCount?: number }) {
  const theme = useAppTheme();
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <BellIcon size={theme.icon.sizes.lg} color={theme.colors.text.muted} weight={theme.icon.weights.regular} />
      {unreadCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 2,
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
  navigation: NavigationProp<Record<Section, undefined>>;
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
        <AppearanceButton />
        <NotificationsButton onPress={onNotifications} unreadCount={unreadCount} />
      </View>
      <AppMenu
        visible={open}
        current={current}
        onClose={() => setOpen(false)}
        onSelect={(section) => {
          setOpen(false);
          if (section !== current)
            navigation.reset(
              section === 'Dashboard'
                ? { index: 0, routes: [{ name: 'Dashboard' }] }
                : { index: 1, routes: [{ name: 'Dashboard' }, { name: section }] },
            );
        }}
      />
    </View>
  );
}

export function getMainHeaderStyle(theme: ThemeParam) {
  return {
    headerShown: true,
    header: ({
      options,
      back,
    }: {
      options: Record<string, unknown>;
      back?: { title: string | undefined; href: string | undefined };
    }) => (
      <Header
        title=""
        headerStyle={{ backgroundColor: theme.colors.surface.base }}
        headerTintColor={theme.colors.text.primary}
        headerShadowVisible={false}
        headerLeft={options.headerLeft as HeaderLeftType}
        headerRight={options.headerRight as HeaderRightType}
        headerLeftContainerStyle={options.headerLeftContainerStyle as Record<string, unknown>}
        headerRightContainerStyle={options.headerRightContainerStyle as Record<string, unknown>}
        back={back}
      />
    ),
  };
}

type HeaderLeftType = ((props: { canGoBack?: boolean }) => React.ReactNode) | undefined;
type HeaderRightType = ((props: { canGoBack: boolean }) => React.ReactNode) | undefined;
