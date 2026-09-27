import React from 'react';
import { DESTINATIONS } from '@ledova/shared';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HouseIcon, WalletIcon, CertificateIcon, BuildingsIcon } from 'phosphor-react-native';
import { ApplicationsStackNavigator, type ApplicationsStackParamList } from './ApplicationsStackNavigator';
import { DirectoryStackNavigator, type DirectoryStackParamList } from './DirectoryStackNavigator';
import { HomeStackNavigator } from './HomeStackNavigator';
import type { HomeStackParamList } from './HomeStackNavigator';
import { WalletsStackNavigator } from './WalletsStackNavigator';
import { TradingStackNavigator } from './TradingStackNavigator';
import { TransactionsScreen } from '../screens/transactions';
import { UserProfileScreen } from '../screens/user-profile';
import { CompanyStackNavigator } from './CompanyStackNavigator';
import type { CompanyStackParamList } from './CompanyStackNavigator';
import { ListingScreen } from '../screens/listing';
import { InvestorEligibilityScreen } from '../screens/investor-eligibility';
import { PublicationsScreen } from '../screens/publications';
import { DividendsScreen } from '../screens/dividends';
import { getMainHeaderStyle, MainHeader } from './headers';
import type { WalletsStackParamList } from './WalletsStackNavigator';
import type { TradingStackParamList } from './TradingStackNavigator';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useRole } from '../hooks/useRole';
import { useAppTheme } from '../contexts';

export type BottomTabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Directory: NavigatorScreenParams<DirectoryStackParamList>;
  Applications: NavigatorScreenParams<ApplicationsStackParamList>;
  Trading: NavigatorScreenParams<TradingStackParamList>;
  Transactions: undefined;
  Wallets: NavigatorScreenParams<WalletsStackParamList>;
  Profile: undefined;
  Company: NavigatorScreenParams<CompanyStackParamList>;
  Listing: undefined;
  InvestorEligibility: undefined;
  Publications: undefined;
  Dividends: undefined;
};

const Tab = createBottomTabNavigator<BottomTabParamList>();

interface BottomTabNavigatorProps {
  onNotifications: () => void;
  unreadCount: number;
}

export function BottomTabNavigator({ onNotifications, unreadCount }: BottomTabNavigatorProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isEnabled } = useFeatureFlags();
  const { isCompany, isInvestor, isLoading: isLoadingRole } = useRole();
  const showTrading = isInvestor && isEnabled('trading_enabled');

  if (isLoadingRole) {
    return null;
  }

  return (
    <Tab.Navigator
      initialRouteName={isCompany ? 'Company' : 'Home'}
      screenOptions={() => ({
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications, unreadCount }),
        tabBarStyle: {
          backgroundColor: theme.colors.surface.base,
          borderTopColor: theme.colors.border.subtle,
          borderTopWidth: 1,
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.colors.interactive.active,
        tabBarInactiveTintColor: theme.colors.text.muted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.medium,
          fontSize: 11,
          lineHeight: 14,
          marginTop: 1,
        },
      })}
    >
      <Tab.Screen
        name="Home"
        options={{
          headerShown: false,
          tabBarLabel: DESTINATIONS.home.title,
          tabBarIcon: ({ color, size }) => <HouseIcon size={size} color={color} weight="regular" />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Home', { screen: 'HomeMain' });
          },
        })}
      >
        {() => <HomeStackNavigator onNotifications={onNotifications} unreadCount={unreadCount} />}
      </Tab.Screen>

      <Tab.Screen
        name="Company"
        component={CompanyStackNavigator}
        options={{
          headerShown: false,
          tabBarLabel: 'Company',
          tabBarIcon: ({ color, size }) => <BuildingsIcon size={size} color={color} weight="regular" />,
          tabBarItemStyle: isCompany ? undefined : { display: 'none' },
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Company', { screen: 'CompanyMain' });
          },
        })}
      />

      <Tab.Screen
        name="Wallets"
        component={WalletsStackNavigator}
        options={{
          headerShown: false,
          tabBarLabel: 'Wallets',
          tabBarIcon: ({ color, size }) => <WalletIcon size={size} color={color} weight="regular" />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Wallets', { screen: 'WalletsList' });
          },
        })}
      />

      {showTrading && (
        <Tab.Screen
          name="Trading"
          component={TradingStackNavigator}
          options={{
            headerShown: false,
            tabBarLabel: DESTINATIONS.trading.title,
            tabBarIcon: ({ color, size }) => <CertificateIcon size={size} color={color} weight="regular" />,
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              e.preventDefault();
              navigation.navigate('Trading', { screen: 'TradingMain' });
            },
          })}
        />
      )}

      <Tab.Screen
        name="Transactions"
        component={TransactionsScreen}
        options={{
          title: '',
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <Tab.Screen
        name="Publications"
        component={PublicationsScreen}
        options={{
          title: '',
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <Tab.Screen
        name="Dividends"
        component={DividendsScreen}
        options={{
          title: 'Dividends',
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <Tab.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{
          title: '',
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <Tab.Screen
        name="Listing"
        component={ListingScreen}
        options={{
          title: DESTINATIONS.companyListing.title,
          tabBarItemStyle: { display: 'none' },
        }}
      />

      {isInvestor && (
        <Tab.Screen name="Directory" options={{ headerShown: false, tabBarItemStyle: { display: 'none' } }}>
          {() => <DirectoryStackNavigator onNotifications={onNotifications} unreadCount={unreadCount} />}
        </Tab.Screen>
      )}

      {isInvestor && (
        <Tab.Screen name="Applications" options={{ headerShown: false, tabBarItemStyle: { display: 'none' } }}>
          {() => <ApplicationsStackNavigator onNotifications={onNotifications} unreadCount={unreadCount} />}
        </Tab.Screen>
      )}

      <Tab.Screen
        name="InvestorEligibility"
        component={InvestorEligibilityScreen}
        options={{
          title: '',
          tabBarItemStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
  );
}
