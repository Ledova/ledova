import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CompanyRegisterScreen } from '../screens/company-register/CompanyRegisterScreen';
import { OfferingsScreen } from '../screens/company-offerings/OfferingsScreen';
import { CompanyScreen } from '../screens/company';
import { CompanyPublicationsScreen } from '../screens/company-publications/CompanyPublicationsScreen';
import { TokenDetailScreen } from '../screens/company-tokens/TokenDetailScreen';
import { useAppTheme } from '../contexts';
import { getMainHeaderStyle } from './headers/MainHeader';
import { MainHeader } from './headers';

export type CompanyStackParamList = {
  CompanyMain: undefined;
  CompanyDetails: undefined;
  CompanyPublications: undefined;
  CompanyOfferings: undefined;
  TokenDetail: { uuid: string; name?: string };
};

const Stack = createNativeStackNavigator<CompanyStackParamList>();

export function CompanyStackNavigator() {
  const theme = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={() => ({
        animation: 'default',
        contentStyle: {
          backgroundColor: theme.colors.surface.base,
        },
        ...getMainHeaderStyle(theme),
        ...MainHeader({ theme, onNotifications: () => {} }),
      })}
    >
      <Stack.Screen name="CompanyMain" component={CompanyRegisterScreen} options={{ title: '' }} />
      <Stack.Screen
        name="CompanyDetails"
        component={CompanyScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyOfferings"
        component={OfferingsScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyPublications"
        component={CompanyPublicationsScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="TokenDetail"
        component={TokenDetailScreen}
        options={() => ({
          title: '',
          headerLeft: undefined,
          headerBackVisible: true,
          headerRight: () => null,
        })}
      />
    </Stack.Navigator>
  );
}
