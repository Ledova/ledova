import { useState } from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getFocusedRouteNameFromRoute, type NavigatorScreenParams } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FolderIcon, HouseIcon, UserIcon } from 'phosphor-react-native';
import { useNotifications } from '@ledova/shared';
import { NotificationsModal, useFollowPush } from '../components/notifications';
import { useAppTheme } from '../contexts';
import { DocumentsScreen } from '../screens/documents/DocumentsScreen';
import { AwardScreen } from '../screens/holdings/AwardScreen';
import { ClassScreen } from '../screens/holdings/ClassScreen';
import { CompanyScreen } from '../screens/holdings/CompanyScreen';
import { DetailsScreen } from '../screens/holdings/DetailsScreen';
import { HoldingsScreen } from '../screens/holdings/HoldingsScreen';
import { InvitationScreen } from '../screens/holdings/InvitationScreen';
import { MemberRecordsProvider } from '../screens/holdings/MemberRecordsProvider';
import { PastHoldingsScreen } from '../screens/holdings/PastHoldingsScreen';
import { SettingsScreen } from '../screens/settings';
import { UserProfileScreen } from '../screens/user-profile';
import { getMainHeaderStyle, MainHeader } from './headers';

export type TabParamList = {
  Holdings: undefined;
  Documents: { company?: string; show?: 'certificates' | 'notices' } | undefined;
  Account: undefined;
};

export type SignedInStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Company: { record: string };
  Class: { record: string; token: string };
  Award: { record: string; award: string };
  Details: { record: string };
  PastHoldings: undefined;
  Invitation: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<SignedInStackParamList>();

function Tabs({ onNotifications, unreadCount }: { onNotifications: () => void; unreadCount: number }) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName="Holdings"
      screenOptions={() => ({
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications, unreadCount }),
        title: '',
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
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.medium,
          fontSize: 11,
          lineHeight: 14,
          marginTop: 1,
        },
      })}
    >
      <Tab.Screen
        name="Holdings"
        component={HoldingsScreen}
        options={{
          tabBarLabel: 'Holdings',
          tabBarIcon: ({ color, size }) => <HouseIcon size={size} color={color} weight="regular" />,
        }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{
          tabBarLabel: 'Documents',
          tabBarIcon: ({ color, size }) => <FolderIcon size={size} color={color} weight="regular" />,
        }}
      />
      <Tab.Screen
        name="Account"
        options={{
          headerRight: () => null,
          tabBarLabel: 'Account',
          tabBarIcon: ({ color, size }) => <UserIcon size={size} color={color} weight="regular" />,
        }}
      >
        {() => <SettingsScreen onNotifications={onNotifications} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function SignedInNavigator() {
  const theme = useAppTheme();
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications();
  useFollowPush();
  return (
    <MemberRecordsProvider>
      <View style={{ flex: 1 }}>
        <Stack.Navigator
          initialRouteName="Main"
          screenOptions={{
            contentStyle: { backgroundColor: theme.colors.surface.base },
            ...getMainHeaderStyle(theme),
          }}
        >
          <Stack.Screen
            name="Main"
            options={({ route }) => ({ headerShown: false, title: getFocusedRouteNameFromRoute(route) ?? 'Holdings' })}
          >
            {() => <Tabs onNotifications={() => setShowNotifications(true)} unreadCount={unreadCount} />}
          </Stack.Screen>
          <Stack.Screen name="Company" component={CompanyScreen} options={{ title: '' }} />
          <Stack.Screen name="Class" component={ClassScreen} options={{ title: '' }} />
          <Stack.Screen name="Award" component={AwardScreen} options={{ title: '' }} />
          <Stack.Screen name="Details" component={DetailsScreen} options={{ title: '' }} />
          <Stack.Screen name="Invitation" component={InvitationScreen} options={{ title: '' }} />
          <Stack.Screen name="PastHoldings" component={PastHoldingsScreen} options={{ title: 'Past holdings' }} />
          <Stack.Screen name="Profile" component={UserProfileScreen} options={{ title: '' }} />
        </Stack.Navigator>
        <NotificationsModal visible={showNotifications} onClose={() => setShowNotifications(false)} />
      </View>
    </MemberRecordsProvider>
  );
}
