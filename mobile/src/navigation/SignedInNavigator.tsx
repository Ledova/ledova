import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import { useNotifications } from '@ledova/shared';
import { NotificationsModal, useFollowPush } from '../components/notifications';
import { useAppTheme } from '../contexts';
import { DocumentsScreen } from '../screens/documents/DocumentsScreen';
import { ClassScreen } from '../screens/holdings/ClassScreen';
import { DetailsScreen } from '../screens/holdings/DetailsScreen';
import { DashboardScreen } from '../screens/holdings/DashboardScreen';
import { InvitationScreen } from '../screens/holdings/InvitationScreen';
import { MemberRecordsProvider } from '../screens/holdings/MemberRecordsProvider';
import { YourDetailsScreen } from '../screens/holdings/YourDetailsScreen';
import { SettingsScreen } from '../screens/settings';
import { UserProfileScreen } from '../screens/user-profile';
import type { Section } from './AppMenu';
import { getMainHeaderStyle, TopBar } from './headers';

export type SignedInStackParamList = {
  Dashboard: { record?: string; award?: string } | undefined;
  Documents: { company?: string; show?: 'certificates' | 'notices' } | undefined;
  Settings: undefined;
  Class: { record: string; token: string };
  Details: { record: string };
  Invitation: undefined;
  YourDetails: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<SignedInStackParamList>();

export function SignedInNavigator() {
  const theme = useAppTheme();
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications();
  const closeNotifications = useCallback(() => setShowNotifications(false), []);
  useFollowPush(closeNotifications);
  const openNotifications = () => setShowNotifications(true);
  const section = (name: Section) => ({
    headerShown: true,
    header: ({ navigation }: { navigation: unknown }) => (
      <TopBar
        navigation={navigation as NavigationProp<Record<Section, undefined>>}
        current={name}
        onNotifications={openNotifications}
        unreadCount={unreadCount}
      />
    ),
  });
  return (
    <MemberRecordsProvider>
      <View style={{ flex: 1 }}>
        <Stack.Navigator
          initialRouteName="Dashboard"
          screenOptions={{
            contentStyle: { backgroundColor: theme.colors.surface.base },
            ...getMainHeaderStyle(theme),
          }}
        >
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={section('Dashboard')} />
          <Stack.Screen name="Documents" component={DocumentsScreen} options={section('Documents')} />
          <Stack.Screen name="Settings" options={section('Settings')}>
            {() => <SettingsScreen onNotifications={openNotifications} />}
          </Stack.Screen>
          <Stack.Screen name="Class" component={ClassScreen} options={{ title: '' }} />
          <Stack.Screen name="Details" component={DetailsScreen} options={{ title: '' }} />
          <Stack.Screen name="Invitation" component={InvitationScreen} options={{ title: '' }} />
          <Stack.Screen name="YourDetails" component={YourDetailsScreen} options={{ title: '' }} />
          <Stack.Screen name="Profile" component={UserProfileScreen} options={{ title: '' }} />
        </Stack.Navigator>
        <NotificationsModal visible={showNotifications} onClose={closeNotifications} />
      </View>
    </MemberRecordsProvider>
  );
}
