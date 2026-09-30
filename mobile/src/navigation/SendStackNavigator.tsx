import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Wallet } from '@ledova/shared';
import { SendScreen } from '../screens/send';
import { useAppTheme } from '../contexts';
import { MainHeader, getMainHeaderStyle } from './headers';

export type SendStackParamList = {
  SendMain: { wallet?: Wallet } | undefined;
};

const Stack = createNativeStackNavigator<SendStackParamList>();

export function SendStackNavigator({
  onNotifications,
  unreadCount,
}: {
  onNotifications: () => void;
  unreadCount: number;
}) {
  const theme = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={() => ({
        animation: 'default',
        contentStyle: {
          backgroundColor: theme.colors.surface.base,
        },
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications, unreadCount }),
      })}
    >
      <Stack.Screen
        name="SendMain"
        component={SendScreen}
        options={() => ({
          title: '',
        })}
      />
    </Stack.Navigator>
  );
}
