import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/home';
import { CompanyTeamScreen } from '../screens/company-team/CompanyTeamScreen';
import { CompanyRegisterScreen } from '../screens/company-register/CompanyRegisterScreen';
import { useAppTheme } from '../contexts';
import { MainHeader, getMainHeaderStyle } from './headers';

export type HomeStackParamList = {
  HomeMain: undefined;
  CompanyTeam: undefined;
  CompanyRegister: undefined;
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

interface HomeStackNavigatorProps {
  onNotifications: () => void;
  unreadCount: number;
}

export function HomeStackNavigator({ onNotifications, unreadCount }: HomeStackNavigatorProps) {
  const theme = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={() => ({
        animation: 'default',
        contentStyle: {
          backgroundColor: theme.colors.surface.base,
        },
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications, unreadCount }),
      })}
    >
      <Stack.Screen
        name="HomeMain"
        component={HomeScreen}
        options={() => ({
          title: '',
        })}
      />
      <Stack.Screen
        name="CompanyTeam"
        component={CompanyTeamScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyRegister"
        component={CompanyRegisterScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
    </Stack.Navigator>
  );
}
