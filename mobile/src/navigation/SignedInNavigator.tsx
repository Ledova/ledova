import { useState } from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FolderIcon, HouseIcon, UserIcon } from 'phosphor-react-native';
import { useNotifications } from '@ledova/shared';
import { NotificationsModal } from '../components/notifications';
import { useAppTheme } from '../contexts';
import { MemberRecordsScreen } from '../screens/member-records/MemberRecordsScreen';
import { PublicationsScreen } from '../screens/publications';
import { SettingsScreen } from '../screens/settings';
import { UserProfileScreen } from '../screens/user-profile';
import { getMainHeaderStyle, MainHeader } from './headers';

export type TabParamList = {
  Holdings: undefined;
  Documents: undefined;
  Account: undefined;
};

export type SignedInStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
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
        component={MemberRecordsScreen}
        options={{
          tabBarLabel: 'Holdings',
          tabBarIcon: ({ color, size }) => <HouseIcon size={size} color={color} weight="regular" />,
        }}
      />
      <Tab.Screen
        name="Documents"
        component={PublicationsScreen}
        options={{
          tabBarLabel: 'Documents',
          tabBarIcon: ({ color, size }) => <FolderIcon size={size} color={color} weight="regular" />,
        }}
      />
      <Tab.Screen
        name="Account"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Account',
          tabBarIcon: ({ color, size }) => <UserIcon size={size} color={color} weight="regular" />,
        }}
      />
    </Tab.Navigator>
  );
}

export function SignedInNavigator() {
  const theme = useAppTheme();
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications();
  return (
    <View style={{ flex: 1 }}>
      <Stack.Navigator
        initialRouteName="Main"
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.surface.base },
          ...getMainHeaderStyle(theme),
        }}
      >
        <Stack.Screen name="Main" options={{ headerShown: false, title: 'Account' }}>
          {() => <Tabs onNotifications={() => setShowNotifications(true)} unreadCount={unreadCount} />}
        </Stack.Screen>
        <Stack.Screen name="Profile" component={UserProfileScreen} options={{ title: '' }} />
      </Stack.Navigator>
      <NotificationsModal visible={showNotifications} onClose={() => setShowNotifications(false)} />
    </View>
  );
}
