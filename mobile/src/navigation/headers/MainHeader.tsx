import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { BellIcon } from 'phosphor-react-native';
import { Header } from '@react-navigation/elements';
import { useAppTheme } from '../../contexts';

type ThemeParam = ReturnType<typeof useAppTheme>;

interface MainHeaderProps {
  theme: ThemeParam;
  onNotifications: () => void;
  unreadCount?: number;
}

export function MainHeader({ theme, onNotifications, unreadCount = 0 }: MainHeaderProps) {
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return {
    headerRight: () => (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        onPress={onNotifications}
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
    ),
    headerRightContainerStyle: { paddingRight: theme.spacing.md, paddingBottom: theme.spacing.xs },
  };
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
