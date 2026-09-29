import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ScrollView, Pressable } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  HouseIcon,
  WalletIcon,
  UserIcon,
  GearIcon,
  LinkIcon,
  CertificateIcon,
  BuildingsIcon,
  BookOpenIcon,
  MegaphoneIcon,
  FileTextIcon,
  NewspaperIcon,
  ShieldCheckIcon,
} from 'phosphor-react-native';
import { signout, describeFailure, DESTINATIONS } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';
import { useAppTheme, useThemedStyles } from '../contexts';
import { NotificationsModal } from '../components/notifications';
import { useNotifications } from '@ledova/shared';
import type { RootStackParamList } from './AppNavigator';
import { BottomTabNavigator } from './BottomTabNavigator';
import { MainHeader, getMainHeaderStyle } from './headers';
import { SignOutModal } from '../components/auth';
import { HelpScreen } from '../screens/help';
import { SettingsScreen } from '../screens/settings';
import { DrawerProvider, useDrawer } from './DrawerContext';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useRole } from '../hooks/useRole';
import { useUserProfile } from '../screens/user-profile/useUserProfile';
import type { ComponentType } from 'react';

export type DrawerParamList = {
  Main: undefined;
  Settings: undefined;
  Help: undefined;
};

const Stack = createNativeStackNavigator<DrawerParamList>();

interface MenuItem {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  action: 'tab' | 'screen';
  target?: string;
}

const SHARE_MENU_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.home.title, icon: HouseIcon, action: 'tab', target: 'Home' },
  { label: DESTINATIONS.publications.title, icon: NewspaperIcon, action: 'tab', target: 'Publications' },
  { label: DESTINATIONS.transactions.title, icon: LinkIcon, action: 'tab', target: 'Transactions' },
];

const COMPANY_MENU_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.companyRegister.title, icon: BookOpenIcon, action: 'tab', target: 'Register' },
  { label: DESTINATIONS.companyOffering.title, icon: MegaphoneIcon, action: 'tab', target: 'CompanyOfferings' },
  { label: DESTINATIONS.company.title, icon: BuildingsIcon, action: 'tab', target: 'Company' },
];

const INVEST_MENU_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.directory.title, icon: BuildingsIcon, action: 'tab', target: 'Directory' },
  { label: DESTINATIONS.subscriptions.title, icon: FileTextIcon, action: 'tab', target: 'Applications' },
  { label: DESTINATIONS.trading.title, icon: CertificateIcon, action: 'tab', target: 'Trading' },
  {
    label: DESTINATIONS.investorEligibility.title,
    icon: ShieldCheckIcon,
    action: 'tab',
    target: 'InvestorEligibility',
  },
];

const SECONDARY_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.wallets.title, icon: WalletIcon, action: 'tab', target: 'Wallets' },
  { label: 'Profile', icon: UserIcon, action: 'tab', target: 'Profile' },
  { label: 'Settings', icon: GearIcon, action: 'screen', target: 'Settings' },
];

function DrawerMenuContent({ onSignOut }: { onSignOut: () => void }) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    drawerContent: {
      flex: 1,
      paddingTop: 50,
      backgroundColor: theme.colors.surface.base,
    },
    destinations: {
      flex: 1,
    },
    help: {
      alignSelf: 'flex-start',
      marginTop: 12,
      marginHorizontal: 28,
      paddingVertical: 10,
    },
    helpText: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
    },
    foot: {
      gap: 2,
      paddingHorizontal: 28,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.default,
    },
    person: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
    },
    signOut: {
      alignSelf: 'flex-start',
      paddingVertical: 10,
    },
    signOutText: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.secondary,
    },
    drawerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.default,
    },
    logo: {
      width: 40,
      height: 32,
    },
    drawerTitle: {
      fontSize: theme.fontSize.xl,
      fontFamily: theme.fontFamily.display,
      color: theme.colors.text.primary,
      marginLeft: 12,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      marginHorizontal: 12,
      borderRadius: theme.borderRadius.md,
    },
    menuText: {
      marginLeft: 16,
      fontSize: theme.fontSize.base,
      fontFamily: theme.fontFamily.medium,
      color: theme.colors.text.primary,
    },
    group: {
      marginTop: 18,
    },
    groupLabel: {
      fontFamily: theme.fontFamily.medium,
      color: theme.colors.text.muted,
      fontSize: 12,
      textTransform: 'uppercase',
      marginHorizontal: 28,
      marginBottom: 4,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border.default,
      marginVertical: 16,
      marginHorizontal: 20,
    },
  }));

  const ICON_PROPS = {
    size: theme.icon.sizes.lg,
    color: theme.colors.text.muted,
    weight: theme.icon.weights.regular,
  } as const;

  const { closeDrawer } = useDrawer();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isEnabled } = useFeatureFlags();
  const { isCompany, isInvestor, isLoading } = useRole();
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;
  const insets = useSafeAreaInsets();

  const handleAction = (item: MenuItem) => {
    closeDrawer();
    if (item.action === 'tab') {
      let params;
      if (item.target === 'Home') {
        params = { screen: 'Home', params: { screen: 'HomeMain' } };
      } else if (item.target === 'Directory') {
        params = { screen: 'Directory', params: { screen: 'DirectoryMain' } };
      } else if (item.target === 'Applications') {
        params = { screen: 'Applications', params: { screen: 'ApplicationsMain' } };
      } else if (item.target === 'Trading') {
        params = { screen: 'Trading', params: { screen: 'TradingMain' } };
      } else if (item.target === 'Company') {
        params = { screen: 'Company', params: { screen: 'CompanyDetails' } };
      } else if (item.target === 'Register') {
        params = { screen: 'Company', params: { screen: 'CompanyMain' } };
      } else if (item.target === 'CompanyOfferings') {
        params = { screen: 'Company', params: { screen: 'CompanyOfferings' } };
      } else if (item.target === 'Wallets') {
        params = { screen: 'Wallets', params: { screen: 'WalletsList' } };
      } else {
        params = { screen: item.target as string };
      }
      navigation.navigate('MainApp', { screen: 'Main', params } as never);
    } else {
      navigation.navigate('MainApp', { screen: item.target } as never);
    }
  };

  const renderItem = (item: MenuItem) => (
    <TouchableOpacity
      key={item.label}
      accessibilityRole="button"
      style={styles.menuItem}
      onPress={() => handleAction(item)}
    >
      <item.icon {...ICON_PROPS} />
      <Text style={styles.menuText}>{item.label}</Text>
    </TouchableOpacity>
  );

  const groups = [
    ...(isCompany ? [{ label: 'Company', items: COMPANY_MENU_ITEMS }] : []),
    { label: 'Your shares', items: SHARE_MENU_ITEMS },
    ...(isInvestor
      ? [
          {
            label: 'Invest',
            items: INVEST_MENU_ITEMS.filter((item) => item.target !== 'Trading' || isEnabled('trading_enabled')),
          },
        ]
      : []),
  ];

  return (
    <View style={styles.drawerContent}>
      <ScrollView style={styles.destinations} contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.drawerHeader}>
          {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
          <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.drawerTitle}>Ledova</Text>
        </View>
        {!isLoading &&
          groups.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text accessibilityRole="header" style={styles.groupLabel}>
                {group.label}
              </Text>
              {group.items.map(renderItem)}
            </View>
          ))}
        <View style={styles.divider} />
        {SECONDARY_ITEMS.map(renderItem)}
        <Pressable
          accessibilityRole="link"
          style={styles.help}
          onPress={() => {
            closeDrawer();
            navigation.navigate('MainApp', { screen: 'Help' } as never);
          }}
        >
          <Text style={styles.helpText}>Help & Support</Text>
        </Pressable>
      </ScrollView>
      <View testID="drawer-foot" style={[styles.foot, { paddingBottom: 12 + insets.bottom }]}>
        {person ? <Text style={styles.person}>{person}</Text> : null}
        <Pressable
          accessibilityRole="button"
          style={styles.signOut}
          onPress={() => {
            closeDrawer();
            onSignOut();
          }}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function DrawerNavigator() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { unreadCount } = useNotifications();

  const handleSignOutConfirm = async () => {
    setIsSigningOut(true);
    try {
      await notificationsService.unregisterToken();
      await signout(apiClient);
    } catch (error) {
      console.error(`Sign-out API call failed: ${describeFailure(error)}`);
    } finally {
      const retired = await clearTokens().then(
        () => true,
        () => false,
      );

      queryClient.clear();
      queryClient.removeQueries();
      queryClient.resetQueries();

      navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
      setIsSigningOut(false);
      setShowSignOutModal(false);
      if (!retired) {
        Alert.alert(
          'Sign-Out Warning',
          'You are signed out, but this device could not confirm that your saved sign-in was removed. If Ledova opens signed in, sign out again.',
        );
      }
    }
  };

  return (
    <DrawerProvider renderMenu={() => <DrawerMenuContent onSignOut={() => setShowSignOutModal(true)} />}>
      <View style={{ flex: 1 }}>
        <Stack.Navigator
          initialRouteName="Main"
          screenOptions={() => ({
            contentStyle: { backgroundColor: theme.colors.surface.base },
            ...getMainHeaderStyle(theme),
            ...MainHeader({ theme, onNotifications: () => setShowNotificationsModal(true), unreadCount }),
          })}
        >
          <Stack.Screen name="Main" options={{ headerShown: false }}>
            {() => (
              <BottomTabNavigator onNotifications={() => setShowNotificationsModal(true)} unreadCount={unreadCount} />
            )}
          </Stack.Screen>
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '' }} />
          <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Help & Support' }} />
        </Stack.Navigator>
      </View>

      <SignOutModal
        visible={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOutConfirm}
        isLoading={isSigningOut}
      />

      <NotificationsModal visible={showNotificationsModal} onClose={() => setShowNotificationsModal(false)} />
    </DrawerProvider>
  );
}
