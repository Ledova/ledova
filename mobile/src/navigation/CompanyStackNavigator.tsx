import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CompanyRegisterScreen } from '../screens/company-register/CompanyRegisterScreen';
import { PrepareRegisterCorrectionScreen } from '../screens/company-register/PrepareRegisterCorrectionScreen';
import { PrepareRegisterImportScreen } from '../screens/company-register/PrepareRegisterImportScreen';
import { OfferingsScreen } from '../screens/company-offerings/OfferingsScreen';
import { CompanyScreen } from '../screens/company';
import { CompanyPublicationsScreen } from '../screens/company-publications/CompanyPublicationsScreen';
import { TokenDetailScreen } from '../screens/company-tokens/TokenDetailScreen';
import { CompanyAuthorityScreen } from '../screens/company-authority/CompanyAuthorityScreen';
import { CompanyTeamScreen } from '../screens/company-team/CompanyTeamScreen';
import { CompanyEligibilityScreen } from '../screens/eligibility-records/CompanyEligibilityScreen';
import { useAppTheme } from '../contexts';
import { getMainHeaderStyle } from './headers/MainHeader';
import { MainHeader } from './headers';

export type CompanyStackParamList = {
  CompanyMain: undefined;
  CompanyDetails: undefined;
  CompanyPublications: undefined;
  CompanyOfferings: undefined;
  CompanyAuthority: undefined;
  CompanyTeam: undefined;
  CompanyEligibility: undefined;
  TokenDetail: { uuid: string; name?: string };
  PrepareRegisterImport: { tokenUuid: string; companyUuid: string };
  PrepareRegisterCorrection: { tokenUuid: string; companyUuid: string; entryUuid: string };
};

const Stack = createNativeStackNavigator<CompanyStackParamList>();

export function CompanyStackNavigator({
  onNotifications,
  unreadCount,
}: {
  onNotifications: () => void;
  unreadCount: number;
}) {
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
      <Stack.Screen name="CompanyMain" component={CompanyRegisterScreen} options={{ title: '' }} />
      <Stack.Screen
        name="CompanyDetails"
        component={CompanyScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyAuthority"
        component={CompanyAuthorityScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyTeam"
        component={CompanyTeamScreen}
        options={{ title: '', headerLeft: undefined, headerBackVisible: true, headerRight: () => null }}
      />
      <Stack.Screen
        name="CompanyEligibility"
        component={CompanyEligibilityScreen}
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
