import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DirectoryScreen } from '../screens/directory/DirectoryScreen';
import { ShareClassScreen } from '../screens/directory/ShareClassScreen';
import { useAppTheme } from '../contexts';
import { useRole } from '../hooks/useRole';
import { MainHeader, getMainHeaderStyle } from './headers';

export type DirectoryStackParamList = {
  DirectoryMain: undefined;
  DirectoryClass: { uuid: string };
};

const Stack = createNativeStackNavigator<DirectoryStackParamList>();

export function DirectoryStackNavigator({
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
      <Stack.Screen name="DirectoryMain" component={DirectoryScreen} />
      <Stack.Screen
        name="DirectoryClass"
        component={ShareClassScreen}
        options={{ headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
    </Stack.Navigator>
  );
}
