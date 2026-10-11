import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MemberRecordsScreen } from '../screens/member-records/MemberRecordsScreen';
import { CompanyEligibilityScreen } from '../screens/eligibility-records/CompanyEligibilityScreen';
import { ParticipantEligibilityScreen } from '../screens/eligibility-records/ParticipantEligibilityScreen';
import { useAppTheme } from '../contexts';
import { MainHeader, getMainHeaderStyle } from './headers';

export type HomeStackParamList = {
  HomeMain: undefined;
  ParticipantEligibility: undefined;
  CompanyEligibility: undefined;
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
        component={MemberRecordsScreen}
        options={() => ({
          title: '',
        })}
      />
      <Stack.Screen
        name="ParticipantEligibility"
        component={ParticipantEligibilityScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyEligibility"
        component={CompanyEligibilityScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
    </Stack.Navigator>
  );
}
