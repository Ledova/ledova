import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ApplicationsScreen } from '../screens/applications/ApplicationsScreen';
import { ApplicationDetailScreen } from '../screens/applications/ApplicationDetailScreen';
import { useAppTheme } from '../contexts';
import { useRole } from '../hooks/useRole';
import { MainHeader, getMainHeaderStyle } from './headers';

export type ApplicationsStackParamList = {
  ApplicationsMain: undefined;
  ApplicationDetail: { uuid: string };
};

const Stack = createNativeStackNavigator<ApplicationsStackParamList>();

export function ApplicationsStackNavigator({
  onNotifications,
  unreadCount,
}: {
  onNotifications: () => void;
  unreadCount: number;
}) {
  const theme = useAppTheme();
  const { isInvestor, isLoading } = useRole();
  if (isLoading || !isInvestor) return null;
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.surface.base },
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications, unreadCount }),
        title: '',
      }}
    >
      <Stack.Screen name="ApplicationsMain" component={ApplicationsScreen} />
      <Stack.Screen
        name="ApplicationDetail"
        component={ApplicationDetailScreen}
        options={{ headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
    </Stack.Navigator>
  );
}
