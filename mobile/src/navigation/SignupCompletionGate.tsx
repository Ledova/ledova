import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth, useUserPreferences } from '@ledova/shared';
import { PrimaryButton } from '../components/buttons';
import { useAppTheme } from '../contexts';
import { useRole } from '../hooks/useRole';
import { useUserProfile } from '../screens/user-profile/useUserProfile';
import type { RootStackParamList } from './AppNavigator';
import { DrawerNavigator } from './DrawerNavigator';

export function SignupCompletionGate() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const auth = useAuth();
  const preferences = useUserPreferences();
  const { isCompany, isLoading: roleLoading } = useRole();
  const { userProfile, profile } = useUserProfile();
  const waiting = auth.isLoading || auth.isFetching || profile.isLoading || profile.isFetching || roleLoading;
  useEffect(() => {
    if (auth.isLoading || auth.isFetching) return;
    if (!auth.isAuthenticated) {
      navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
    } else if (!waiting && !profile.isError && userProfile && !userProfile.isSignupCompleted) {
      navigation.reset({ index: 0, routes: [{ name: isCompany ? 'CompanyRegistration' : 'AccountType' }] });
    }
  }, [
    auth.isAuthenticated,
    auth.isLoading,
    auth.isFetching,
    waiting,
    profile.isError,
    userProfile,
    isCompany,
    navigation,
  ]);
  if (!waiting && !profile.isError && userProfile?.isSignupCompleted) return <DrawerNavigator />;
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      {waiting || !auth.isAuthenticated || (!profile.isError && userProfile) ? (
        <>
          <ActivityIndicator color={theme.colors.interactive.active} />
          <Text style={{ color: theme.colors.text.muted }}>Checking your account…</Text>
        </>
      ) : (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.colors.status.error.icon }}>
            Your signup progress could not be checked. Try again before opening your account.
          </Text>
          <PrimaryButton
            onPress={() => {
              void Promise.all([auth.refetch(), preferences.refetch(), profile.refetch()]);
            }}
          >
            Try again
          </PrimaryButton>
        </>
      )}
    </View>
  );
}
