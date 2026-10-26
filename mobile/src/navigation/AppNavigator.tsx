import React from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SignInScreen } from '../screens/signin';
import { SignUpScreen } from '../screens/signup/user';
import { EmailConfirmationScreen } from '../screens/signup/email-confirmation';
import { PreScreeningScreen } from '../screens/signup/pre-screening';
import { UserProfileScreen } from '../screens/signup/user-profile';
import { FinancialProfileScreen } from '../screens/signup/financial-profile';
import { ReviewScreen } from '../screens/signup/review';
import { AccountTypeScreen } from '../screens/signup/account-type';
import { ShareholdersOnlyScreen } from '../screens/signup/shareholders-only';
import { SignupCompletionGate } from './SignupCompletionGate';
import type { SignedInStackParamList } from './SignedInNavigator';
import { useAppTheme } from '../contexts';

export type RootStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  EmailConfirmation: undefined;
  AccountType: undefined;
  PreScreening: undefined;
  UserProfile: undefined;
  FinancialProfile: undefined;
  ShareholdersOnly: undefined;
  Review: undefined;
  MainApp: NavigatorScreenParams<SignedInStackParamList> | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  const theme = useAppTheme();
  const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      theme={{
        ...base,
        dark: theme.mode === 'dark',
        colors: {
          ...base.colors,
          background: theme.colors.surface.base,
          card: theme.colors.surface.base,
          text: theme.colors.text.primary,
          border: theme.colors.border.default,
          primary: theme.colors.brand.light,
        },
      }}
    >
      <Stack.Navigator
        initialRouteName="SignIn"
        screenOptions={{
          headerStyle: {
            backgroundColor: theme.colors.surface.base,
          },
          headerTintColor: theme.colors.text.primary,
          headerTitleStyle: {
            fontFamily: theme.fontFamily.display,
          },
          contentStyle: {
            backgroundColor: theme.colors.surface.base,
          },
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
        }}
      >
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{
            headerShown: false,
            animation: 'slide_from_left',
          }}
        />
        <Stack.Screen
          name="SignUp"
          component={SignUpScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="EmailConfirmation"
          component={EmailConfirmationScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="AccountType"
          component={AccountTypeScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="PreScreening"
          component={PreScreeningScreen}
          options={{
            headerShown: false,
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="UserProfile"
          component={UserProfileScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="FinancialProfile"
          component={FinancialProfileScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="ShareholdersOnly"
          component={ShareholdersOnlyScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Review"
          component={ReviewScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="MainApp"
          component={SignupCompletionGate}
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
