import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Pressable, Linking } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, useNavigationState, NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  HouseIcon,
  WalletIcon,
  UserIcon,
  GearIcon,
  LinkIcon,
  CertificateIcon,
  BuildingsIcon,
  FileTextIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  DotsThreeIcon,
} from 'phosphor-react-native';
import { DESTINATIONS, useNotifications } from '@ledova/shared';
import { WEB_APP_URL } from '../config/publicLinks';
import { useAppTheme, useThemedStyles } from '../contexts';
import { NotificationsModal } from '../components/notifications';
import { LogoMark } from '../components/LogoMark';
import type { RootStackParamList } from './AppNavigator';
import { BottomTabNavigator } from './BottomTabNavigator';
import { MainHeader, getMainHeaderStyle } from './headers';
import { SignOutModal } from '../components/auth';
import { HelpScreen } from '../screens/help';
import { SettingsScreen } from '../screens/settings';
import { DrawerProvider, useDrawer } from './DrawerContext';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useRole } from '../hooks/useRole';
import { useSignOut } from '../hooks/useSignOut';
import { useUserProfile } from '../hooks/useUserProfile';
import type { ComponentType } from 'react';
import { LedgerNavigationProvider } from './LedgerNavigation';

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
  action: 'tab' | 'screen' | 'web';
  target?: string;
}

const SHARE_MENU_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.home.title, icon: HouseIcon, action: 'tab', target: 'Home' },
];

const COMPANY_WEB_ITEM: MenuItem = { label: 'Company on the web', icon: BuildingsIcon, action: 'web' };

interface NavigationTree {
  index?: number;
  routes: { name: string; state?: NavigationTree }[];
}

function currentNames(tree: NavigationTree | undefined) {
  const names: string[] = [];
  let current = tree;
  while (current?.routes.length) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    names.push(route.name);
    current = route.state;
  }
  return names;
}

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
  { label: DESTINATIONS.publications.title, icon: NewspaperIcon, action: 'tab', target: 'Publications' },
  { label: DESTINATIONS.transactions.title, icon: LinkIcon, action: 'tab', target: 'Transactions' },
];

const ACCOUNT_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.userProfile.title, icon: UserIcon, action: 'tab', target: 'Profile' },
  { label: DESTINATIONS.settings.title, icon: GearIcon, action: 'screen', target: 'Settings' },
];

function DrawerMenuContent({ onSignOut }: { onSignOut: () => void }) {
  const theme = useAppTheme();
  const [more, setMore] = useState(false);
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
    current: {
      backgroundColor: theme.colors.brand.tint,
    },
    currentText: {
      color: theme.colors.interactive.active,
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
  const names = useNavigationState((state) => currentNames(state as unknown as NavigationTree));
  const isCurrent = (item: MenuItem) => !!item.target && names.includes(item.target);

  const handleAction = (item: MenuItem) => {
    closeDrawer();
    if (item.action === 'web') {
      void Linking.openURL(WEB_APP_URL);
    } else if (item.action === 'tab') {
      let params;
      if (item.target === 'Home') {
        params = { screen: 'Home', params: { screen: 'HomeMain' } };
      } else if (item.target === 'Directory') {
        params = { screen: 'Directory', params: { screen: 'DirectoryMain' } };
      } else if (item.target === 'Applications') {
        params = { screen: 'Applications', params: { screen: 'ApplicationsMain' } };
      } else if (item.target === 'Trading') {
        params = { screen: 'Trading', params: { screen: 'TradingMain' } };
      } else if (item.target === 'Wallets') {
        params = { screen: 'Wallets', params: { screen: 'WalletsList' } };
      } else {
        params = { screen: item.target as string };
      }
      navigation.navigate('MainApp', { screen: 'Main', params, pop: true } as never);
    } else {
      navigation.navigate('MainApp', { screen: item.target } as never);
    }
  };

  const renderItem = (item: MenuItem, current = isCurrent(item)) => (
    <TouchableOpacity
      key={item.label}
      accessibilityRole={item.action === 'web' ? 'link' : 'button'}
      accessibilityState={{ selected: current }}
      style={[styles.menuItem, current && styles.current]}
      onPress={() => handleAction(item)}
    >
      <item.icon
        {...ICON_PROPS}
        color={current ? theme.colors.interactive.active : ICON_PROPS.color}
        weight={current ? 'fill' : ICON_PROPS.weight}
      />
      <Text style={[styles.menuText, current && styles.currentText]}>{item.label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.drawerContent}>
      <ScrollView style={styles.destinations} contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.drawerHeader}>
          <LogoMark width={40} height={32} />
          <Text style={styles.drawerTitle}>Ledova</Text>
        </View>
        {!isLoading && (
          <View style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupLabel}>
              Your shares
            </Text>
            {SHARE_MENU_ITEMS.map((item) => renderItem(item))}
          </View>
        )}
        <View style={styles.divider} />
        {!isLoading && isCompany && renderItem(COMPANY_WEB_ITEM)}
        {ACCOUNT_ITEMS.map((item) => renderItem(item))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          style={styles.menuItem}
          onPress={() => setMore((value) => !value)}
        >
          <DotsThreeIcon {...ICON_PROPS} />
          <Text style={styles.menuText}>More</Text>
        </Pressable>
        {more && (
          <>
            {!isLoading && isInvestor && (
              <View style={styles.group}>
                <Text accessibilityRole="header" style={styles.groupLabel}>
                  Invest
                </Text>
                {INVEST_MENU_ITEMS.filter((item) => item.target !== 'Trading' || isEnabled('trading_enabled')).map(
                  (item) => renderItem(item),
                )}
              </View>
            )}
            {SECONDARY_ITEMS.map((item) => renderItem(item))}
          </>
        )}
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
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const { signOut, signingOut } = useSignOut();
  const { unreadCount } = useNotifications();

  const handleSignOutConfirm = async () => {
    await signOut();
    setShowSignOutModal(false);
  };

  return (
    <LedgerNavigationProvider>
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
          isLoading={signingOut}
        />

        <NotificationsModal visible={showNotificationsModal} onClose={() => setShowNotificationsModal(false)} />
      </DrawerProvider>
    </LedgerNavigationProvider>
  );
}
