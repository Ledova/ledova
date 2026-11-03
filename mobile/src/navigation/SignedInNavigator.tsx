import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator, type NativeStackHeaderProps } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import { useNotifications } from '@ledova/shared';
import type { Anchor } from '../components/AnchoredPanel';
import { InSignedInFrame, type FrameOptions } from '../components/InSignedInFrame';
import { NotificationsPanel, useFollowPush } from '../components/notifications';
import { MemberRecordsProvider, useAppTheme } from '../contexts';
import { CertificatesScreen } from '../screens/documents/CertificatesScreen';
import { CompanyPackScreen } from '../screens/documents/CompanyPackScreen';
import { InspectionCopiesScreen } from '../screens/documents/InspectionCopiesScreen';
import { DashboardScreen } from '../screens/holdings/DashboardScreen';
import { InvitationScreen } from '../screens/holdings/InvitationScreen';
import { AccountScreen, DataPrivacyScreen, SettingsScreen } from '../screens/settings';
import { ActivationScreen } from '../screens/settings/ActivationScreen';
import { AuthorityRequestScreen } from '../screens/settings/AuthorityRequestScreen';
import { AuthorityScreen } from '../screens/settings/AuthorityScreen';
import { TeamScreen } from '../screens/settings/TeamScreen';
import type { MenuRoute, Section } from './AppMenu';
import { TopBar } from './headers';

export type SignedInStackParamList = {
  Dashboard: { record?: string; award?: string } | undefined;
  Certificates: { record?: string; token?: string } | undefined;
  InspectionCopies: undefined;
  CompanyPack: undefined;
  Settings: undefined;
  Account: undefined;
  DataPrivacy: undefined;
  Team: undefined;
  Activation: undefined;
  Authority: undefined;
  AuthorityRequest: { uuid: string };
  Invitation: undefined;
};

const Stack = createNativeStackNavigator<SignedInStackParamList>();

export function SignedInNavigator() {
  const theme = useAppTheme();
  const [notificationsAnchor, setNotificationsAnchor] = useState<Anchor | null>(null);
  const { unreadCount } = useNotifications();
  const closeNotifications = useCallback(() => setNotificationsAnchor(null), []);
  useFollowPush(closeNotifications);
  const topBar = (current: Section) => ({
    headerShown: true,
    header: ({ navigation, route, options }: NativeStackHeaderProps) => (
      <TopBar
        navigation={navigation as NavigationProp<Record<MenuRoute, undefined>>}
        route={route.name}
        title={options.title}
        action={(options as FrameOptions).action}
        current={current}
        onNotifications={setNotificationsAnchor}
        notificationsOpen={!!notificationsAnchor}
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
            <Stack.Screen name="InspectionCopies" component={InspectionCopiesScreen} options={topBar('Documents')} />
            <Stack.Screen name="CompanyPack" component={CompanyPackScreen} options={topBar('Documents')} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={topBar('Settings')} />
            <Stack.Screen name="Account" component={AccountScreen} options={topBar('Settings')} />
            <Stack.Screen name="DataPrivacy" component={DataPrivacyScreen} options={topBar('Settings')} />
            <Stack.Screen name="Team" component={TeamScreen} options={topBar('Settings')} />
            <Stack.Screen name="Activation" component={ActivationScreen} options={topBar('Settings')} />
            <Stack.Screen name="Authority" component={AuthorityScreen} options={topBar('Settings')} />
            <Stack.Screen name="AuthorityRequest" component={AuthorityRequestScreen} options={topBar('Settings')} />
            <Stack.Screen name="Invitation" component={InvitationScreen} options={topBar('Dashboard')} />
          </Stack.Navigator>
          <NotificationsPanel anchor={notificationsAnchor} onClose={closeNotifications} />
        </View>
      </InSignedInFrame.Provider>
    </MemberRecordsProvider>
  );
}
