import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator, type NativeStackHeaderProps } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import { useNotifications } from '@ledova/shared';
import { InSignedInFrame, type FrameOptions } from '../components/InSignedInFrame';
import { NotificationsModal, useFollowPush } from '../components/notifications';
import { useAppTheme } from '../contexts';
import { CertificatesScreen } from '../screens/documents/CertificatesScreen';
import { NoticesScreen } from '../screens/documents/NoticesScreen';
import { DetailsScreen } from '../screens/holdings/DetailsScreen';
import { DashboardScreen } from '../screens/holdings/DashboardScreen';
import { InvitationScreen } from '../screens/holdings/InvitationScreen';
import { MemberRecordsProvider } from '../screens/holdings/MemberRecordsProvider';
import { YourDetailsScreen } from '../screens/holdings/YourDetailsScreen';
import { SettingsScreen } from '../screens/settings';
import { UserProfileScreen } from '../screens/user-profile';
import type { MenuRoute, Section } from './AppMenu';
import { TopBar } from './headers';

export type SignedInStackParamList = {
  Dashboard: { record?: string; award?: string } | undefined;
  Certificates: { record?: string; token?: string; company?: string } | undefined;
  Notices: undefined;
  Settings: undefined;
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
  const topBar = (current: Section) => ({
    headerShown: true,
    header: ({ navigation, route, options }: NativeStackHeaderProps) => (
      <TopBar
        navigation={navigation as NavigationProp<Record<MenuRoute, undefined>>}
        route={route.name}
        title={options.title}
        action={(options as FrameOptions).action}
        current={current}
        onNotifications={openNotifications}
        unreadCount={unreadCount}
      />
    ),
  });
  return (
    <MemberRecordsProvider>
      <InSignedInFrame.Provider value>
        <View style={{ flex: 1 }}>
          <Stack.Navigator
            initialRouteName="Dashboard"
            screenOptions={{ contentStyle: { backgroundColor: theme.colors.surface.base } }}
          >
            <Stack.Screen name="Dashboard" component={DashboardScreen} options={topBar('Dashboard')} />
            <Stack.Screen name="Certificates" component={CertificatesScreen} options={topBar('Documents')} />
            <Stack.Screen name="Notices" component={NoticesScreen} options={topBar('Documents')} />
            <Stack.Screen name="Settings" options={topBar('Settings')}>
              {() => <SettingsScreen onNotifications={openNotifications} />}
            </Stack.Screen>
            <Stack.Screen name="Details" component={DetailsScreen} options={topBar('Settings')} />
            <Stack.Screen name="Invitation" component={InvitationScreen} options={topBar('Dashboard')} />
            <Stack.Screen name="YourDetails" component={YourDetailsScreen} options={topBar('Settings')} />
            <Stack.Screen name="Profile" component={UserProfileScreen} options={topBar('Settings')} />
          </Stack.Navigator>
          <NotificationsModal visible={showNotifications} onClose={closeNotifications} />
        </View>
      </InSignedInFrame.Provider>
    </MemberRecordsProvider>
  );
}
