import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/home';
import { CompanyTeamScreen } from '../screens/company-team/CompanyTeamScreen';
import { CompanyRegisterScreen } from '../screens/company-register/CompanyRegisterScreen';
import { PrepareRegisterCorrectionScreen } from '../screens/company-register/PrepareRegisterCorrectionScreen';
import { PrepareRegisterImportScreen } from '../screens/company-register/PrepareRegisterImportScreen';
import { PrepareRegisterOpeningScreen } from '../screens/company-register/PrepareRegisterOpeningScreen';
import { useAppTheme } from '../contexts';
import { MainHeader, getMainHeaderStyle } from './headers';

export type HomeStackParamList = {
  HomeMain: undefined;
  CompanyTeam: undefined;
  CompanyRegister: undefined;
  PrepareRegisterOpening: { tokenUuid: string; companyUuid: string };
  PrepareRegisterImport: { tokenUuid: string; companyUuid: string };
  PrepareRegisterCorrection: { tokenUuid: string; companyUuid: string; entryUuid: string };
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
      <Stack.Screen
        name="PrepareRegisterOpening"
        component={PrepareRegisterOpeningScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="PrepareRegisterImport"
        component={PrepareRegisterImportScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="PrepareRegisterCorrection"
        component={PrepareRegisterCorrectionScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
    </Stack.Navigator>
  );
}
