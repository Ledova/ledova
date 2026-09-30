import React from 'react';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { BuyStackNavigator, type BuyStackParamList } from './BuyStackNavigator';
import { SendStackNavigator, type SendStackParamList } from './SendStackNavigator';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WalletsScreen } from '../screens/wallets';
import { WalletActionScreen } from '../screens/wallets/components/WalletActionScreen';
import { WalletVerificationScreen } from '../screens/wallets/components/WalletVerificationScreen';
import { SeedPhraseBackupScreen } from '../screens/wallets/components/SeedPhraseBackupScreen';
import { TransferFormScreen } from '../screens/transfers/components/TransferFormScreen';
import { OnRampWebViewScreen } from '../screens/wallets/components/OnRampWebViewScreen';
import type { OnRampWebViewParams } from '../screens/wallets/components/OnRampWebViewScreen';
import { useAppTheme } from '../contexts';
import { MainHeader } from './headers';
import type { Wallet } from '@ledova/shared';
import { getMainHeaderStyle } from './headers/MainHeader';

export type WalletsStackParamList = {
  WalletsList: undefined;
  Buy: NavigatorScreenParams<BuyStackParamList>;
  Send: NavigatorScreenParams<SendStackParamList>;
  WalletAction: {
    wallet: Wallet;
  };
  TransferDetails: {
    wallet: Wallet;
    chosen?: boolean;
  };
  WalletVerification: {
    wallet: Wallet;
  };
  SeedPhraseBackup: {
    seedIdentifier: string;
  };
  OnRampWebView: OnRampWebViewParams;
};

const Stack = createNativeStackNavigator<WalletsStackParamList>();

export function WalletsStackNavigator({
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
        name="WalletsList"
        component={WalletsScreen}
        options={() => ({
          title: '',
        })}
      />
      <Stack.Screen name="Buy" options={{ headerShown: false }}>
        {() => <BuyStackNavigator onNotifications={onNotifications} unreadCount={unreadCount} />}
      </Stack.Screen>
      <Stack.Screen name="Send" options={{ headerShown: false }}>
        {() => <SendStackNavigator onNotifications={onNotifications} unreadCount={unreadCount} />}
      </Stack.Screen>
      <Stack.Screen
        name="WalletAction"
        component={WalletActionScreen}
        options={() => ({
          title: '',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
      <Stack.Screen
        name="TransferDetails"
        component={TransferFormScreen}
        options={() => ({
          title: '',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
      <Stack.Screen
        name="WalletVerification"
        component={WalletVerificationScreen}
        options={() => ({
          title: '',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
      <Stack.Screen
        name="SeedPhraseBackup"
        component={SeedPhraseBackupScreen}
        options={() => ({
          title: '',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
      <Stack.Screen
        name="OnRampWebView"
        component={OnRampWebViewScreen}
        options={() => ({
          title: 'Buy Crypto',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
    </Stack.Navigator>
  );
}
