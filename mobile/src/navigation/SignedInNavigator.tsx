import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
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
import { YourDetailsScreen } from '../screens/holdings/YourDetailsScreen';
import { SettingsScreen } from '../screens/settings';
import { UserProfileScreen } from '../screens/user-profile';
import type { Section } from './AppMenu';
import { getMainHeaderStyle, TopBar } from './headers';

export type SignedInStackParamList = {
  Dashboard: undefined;
  Documents: { company?: string; show?: 'certificates' | 'notices' } | undefined;
  Settings: undefined;
  Company: { record: string };
  Class: { record: string; token: string };
  Award: { record: string; award: string };
  Details: { record: string };
  PastHoldings: undefined;
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
          <Stack.Screen name="Dashboard" component={HoldingsScreen} options={section('Dashboard')} />
          <Stack.Screen name="Documents" component={DocumentsScreen} options={section('Documents')} />
          <Stack.Screen name="Settings" options={section('Settings')}>
            {() => <SettingsScreen onNotifications={openNotifications} />}
          </Stack.Screen>
          <Stack.Screen name="Company" component={CompanyScreen} options={{ title: '' }} />
          <Stack.Screen name="Class" component={ClassScreen} options={{ title: '' }} />
          <Stack.Screen name="Award" component={AwardScreen} options={{ title: '' }} />
          <Stack.Screen name="Details" component={DetailsScreen} options={{ title: '' }} />
          <Stack.Screen name="Invitation" component={InvitationScreen} options={{ title: '' }} />
          <Stack.Screen name="YourDetails" component={YourDetailsScreen} options={{ title: '' }} />
          <Stack.Screen name="PastHoldings" component={PastHoldingsScreen} options={{ title: 'Past holdings' }} />
          <Stack.Screen name="Profile" component={UserProfileScreen} options={{ title: '' }} />
        </Stack.Navigator>
        <NotificationsModal visible={showNotifications} onClose={closeNotifications} />
      </View>
    </MemberRecordsProvider>
  );
}
