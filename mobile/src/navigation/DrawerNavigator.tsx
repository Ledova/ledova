import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, Pressable } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, useNavigationState, NavigationProp } from '@react-navigation/native';
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
  FolderIcon,
  DotsThreeIcon,
  CaretDownIcon,
  CaretRightIcon,
  UsersIcon,
  UsersThreeIcon,
} from 'phosphor-react-native';
import {
  signout,
  describeFailure,
  DESTINATIONS,
  useNotifications,
  useUserPreferences,
  type LedgerTask,
} from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';
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
import { useRegisterAccess } from '../hooks/useCompanyRegister';
import { useUserProfile } from '../hooks/useUserProfile';
import type { ComponentType } from 'react';
import type { CompanyRegisterSection } from '../screens/company-register/CompanyRegisterScreen';
import type { CompanyStackParamList } from './CompanyStackNavigator';
import { isLedgerTask, LedgerNavigationProvider, useLedgerNavigation } from './LedgerNavigation';

export type DrawerParamList = {
  Main: undefined;
  Settings: undefined;
  Help: undefined;
};

const Stack = createNativeStackNavigator<DrawerParamList>();

interface MenuItem {
  label: string;
  short?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ComponentType<any>;
  action: 'tab' | 'screen';
  target?: string;
  section?: CompanyRegisterSection;
}

const SHARE_MENU_ITEMS: MenuItem[] = [
  { label: DESTINATIONS.home.title, icon: HouseIcon, action: 'tab', target: 'Home' },
];

const LEDGER_ITEM: MenuItem = {
  label: DESTINATIONS.companyRegister.title,
  icon: BookOpenIcon,
  action: 'tab',
  target: 'CompanyRegister',
  section: 'ledger',
};

const LEDGER_TASKS = Object.entries(DESTINATIONS.companyRegister.tasks) as [LedgerTask, string][];

const COMPANY_MENU_ITEMS: MenuItem[] = [
  {
    label: DESTINATIONS.companyRegister.views.shareholders,
    icon: UsersThreeIcon,
    action: 'tab',
    target: 'CompanyRegister',
    section: 'shareholders',
  },
  {
    label: DESTINATIONS.companyRegister.views.awards,
    short: 'ESS',
    icon: UsersIcon,
    action: 'tab',
    target: 'CompanyRegister',
    section: 'awards',
  },
  {
    label: DESTINATIONS.companyRegister.views.documents,
    icon: FolderIcon,
    action: 'tab',
    target: 'CompanyRegister',
    section: 'documents',
  },
  {
    label: DESTINATIONS.company.title,
    icon: BuildingsIcon,
    action: 'tab',
    target: 'CompanyRegister',
    section: 'company',
  },
];

const COMPANY_SCREEN_SECTIONS: Partial<Record<string, CompanyRegisterSection>> = {
  TokenDetail: 'ledger',
  PrepareRegisterImport: 'ledger',
  PrepareRegisterGrant: 'issue',
  PrepareRegisterTransfer: 'transfer',
  PrepareRegisterCorrection: 'corrections',
  PrepareRegisterOpening: 'corrections',
  PrepareRegisterLink: 'corrections',
  PrepareRegisterParticulars: 'corrections',
} satisfies Partial<Record<keyof CompanyStackParamList, CompanyRegisterSection>>;

interface NavigationTree {
  index?: number;
  routes: { name: string; params?: object; state?: NavigationTree }[];
}

function currentPlace(tree: NavigationTree | undefined) {
  const routes: { name: string; params?: object }[] = [];
  let current = tree;
  while (current?.routes.length) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    routes.push(route);
    current = route.state;
  }
  const names = routes.map(({ name }) => name);
  const company = names.indexOf('Company');
  const screen = company < 0 ? undefined : (routes[company + 1] ?? { name: 'CompanyMain' });
  const section =
    screen?.name === 'CompanyMain'
      ? ((screen.params as { section?: CompanyRegisterSection } | undefined)?.section ?? 'ledger')
      : screen && COMPANY_SCREEN_SECTIONS[screen.name];
  return { names, screen: screen?.name, section };
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
  { label: DESTINATIONS.companyOffering.title, icon: MegaphoneIcon, action: 'tab', target: 'CompanyOfferings' },
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
    unavailable: {
      opacity: 0.5,
    },
    ledgerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 12,
    },
    ledgerLink: {
      flex: 1,
      marginRight: 4,
    },
    caret: {
      width: 40,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.borderRadius.md,
    },
    tasks: {
      marginLeft: 40,
      marginRight: 12,
      paddingLeft: 12,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.border.subtle,
    },
    task: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: theme.borderRadius.md,
    },
    taskText: {
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
  const preferences = useUserPreferences();
  const { allowed: readsRegister } = useRegisterAccess(
    !preferences.isLoading && !preferences.isError && !!preferences.userAccount,
  );
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;
  const insets = useSafeAreaInsets();
  const place = useNavigationState((state) => currentPlace(state as unknown as NavigationTree));
  const { state: ledger } = useLedgerNavigation();
  const onLedgerScreen = place.screen === 'CompanyMain';
  const ledgerHere = place.section === 'ledger' || isLedgerTask(place.section);
  const routedTask = onLedgerScreen && isLedgerTask(place.section) ? place.section : undefined;
  const task = onLedgerScreen
    ? ledgerHere
      ? ledger?.blocked && ledger.task
        ? ledger.task
        : (routedTask ?? ledger?.task)
      : undefined
    : isLedgerTask(place.section)
      ? place.section
      : undefined;
  const blocked = onLedgerScreen && (!ledger || ledger.blocked);
  const blocks = (key?: LedgerTask) => blocked && !(key && ledger?.task === key && !routedTask);
  const [expanded, setExpanded] = useState(ledgerHere);
  const isCurrent = (item: MenuItem) => {
    if (item.target === 'CompanyRegister') return place.section === item.section;
    if (item.target === 'CompanyDetails' || item.target === 'CompanyOfferings') return place.screen === item.target;
    return !!item.target && place.names.includes(item.target);
  };

  const handleAction = (item: MenuItem) => {
    closeDrawer();
    if (item.action === 'tab') {
      let params;
      if (item.target === 'Home') {
        params = { screen: 'Home', params: { screen: 'HomeMain' } };
      } else if (item.target === 'CompanyRegister') {
        params = { screen: 'Company', params: { screen: 'CompanyMain', params: { section: item.section }, pop: true } };
      } else if (item.target === 'Directory') {
        params = { screen: 'Directory', params: { screen: 'DirectoryMain' } };
      } else if (item.target === 'Applications') {
        params = { screen: 'Applications', params: { screen: 'ApplicationsMain' } };
      } else if (item.target === 'Trading') {
        params = { screen: 'Trading', params: { screen: 'TradingMain' } };
      } else if (item.target === 'CompanyDetails') {
        params = { screen: 'Company', params: { screen: 'CompanyDetails' } };
      } else if (item.target === 'CompanyOfferings') {
        params = { screen: 'Company', params: { screen: 'CompanyOfferings' } };
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

  const renderItem = (item: MenuItem, current = isCurrent(item), disabled = false) => (
    <TouchableOpacity
      key={item.label}
      accessibilityRole="button"
      accessibilityLabel={item.short ? item.label : undefined}
      accessibilityState={{ selected: current, disabled }}
      disabled={disabled}
      style={[styles.menuItem, current && styles.current, disabled && styles.unavailable]}
      onPress={() => handleAction(item)}
    >
      <item.icon
        {...ICON_PROPS}
        color={current ? theme.colors.interactive.active : ICON_PROPS.color}
        weight={current ? 'fill' : ICON_PROPS.weight}
      />
      <Text style={[styles.menuText, current && styles.currentText]}>{item.short ?? item.label}</Text>
    </TouchableOpacity>
  );

  const Caret = expanded ? CaretDownIcon : CaretRightIcon;
  const ledgerGroup = (
    <View key="ledger">
      <View style={styles.ledgerRow}>
        <View style={styles.ledgerLink}>{renderItem(LEDGER_ITEM, ledgerHere && !task, blocks())}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} Ledger navigation`}
          accessibilityState={{ expanded }}
          style={styles.caret}
          onPress={() => setExpanded((value) => !value)}
        >
          <Caret size={16} color={theme.colors.text.muted} />
        </Pressable>
      </View>
      {expanded && (
        <View style={styles.tasks}>
          {LEDGER_TASKS.map(([key, label]) => (
            <TouchableOpacity
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: task === key, disabled: blocks(key) }}
              disabled={blocks(key)}
              style={[styles.task, task === key && styles.current, blocks(key) && styles.unavailable]}
              onPress={() => handleAction({ ...LEDGER_ITEM, label, section: key })}
            >
              <Text style={[styles.taskText, task === key && styles.currentText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const groups = [
    ...(readsRegister
      ? [{ id: 'company', label: DESTINATIONS.company.title, ledger: true, items: COMPANY_MENU_ITEMS }]
      : []),
    { id: 'shares', label: 'Your shares', ledger: false, items: SHARE_MENU_ITEMS },
  ];

  return (
    <View style={styles.drawerContent}>
      <ScrollView style={styles.destinations} contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={styles.drawerHeader}>
          <LogoMark width={40} height={32} />
          <Text style={styles.drawerTitle}>Ledova</Text>
        </View>
        {!isLoading &&
          groups.map((group) => (
            <View key={group.id} style={styles.group}>
              <Text accessibilityRole="header" style={styles.groupLabel}>
                {group.label}
              </Text>
              {group.ledger && ledgerGroup}
              {group.items.map((item) => renderItem(item))}
            </View>
          ))}
        <View style={styles.divider} />
        {!isLoading &&
          isCompany &&
          !readsRegister &&
          renderItem({
            label: DESTINATIONS.company.title,
            icon: BuildingsIcon,
            action: 'tab',
            target: 'CompanyDetails',
          })}
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
            {SECONDARY_ITEMS.filter((item) => item.target !== 'CompanyOfferings' || isCompany).map((item) =>
              renderItem(item),
            )}
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
          isLoading={isSigningOut}
        />

        <NotificationsModal visible={showNotificationsModal} onClose={() => setShowNotificationsModal(false)} />
      </DrawerProvider>
    </LedgerNavigationProvider>
  );
}
