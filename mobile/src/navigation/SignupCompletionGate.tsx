import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth, useUserPreferences } from '@ledova/shared';
import { PrimaryButton } from '../components/buttons';
import { useAppTheme } from '../contexts';
import { useRole } from '../hooks/useRole';
import { useUserProfile } from '../hooks/useUserProfile';
import type { RootStackParamList } from './AppNavigator';
import { SignedInNavigator } from './SignedInNavigator';

export function SignupCompletionGate() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const auth = useAuth();
  const preferences = useUserPreferences();
  const { isCompany, isLoading: roleLoading } = useRole();
  const { userProfile, profile } = useUserProfile();
  const waiting = auth.isLoading || auth.isFetching || profile.isLoading || profile.isFetching || roleLoading;
  const completed = !waiting && !profile.isError && !!userProfile?.isSignupCompleted;
  const failed = profile.isError || (preferences.isError && !!userProfile && !userProfile.isSignupCompleted);
  const [opened, setOpened] = useState(false);
  if (completed && !opened) setOpened(true);
  const rereading = auth.isFetching || preferences.isFetching || profile.isFetching;
  const kept =
    opened && auth.isAuthenticated && (userProfile ? userProfile.isSignupCompleted : rereading && !profile.isError);
  useEffect(() => {
    if (auth.isLoading || auth.isFetching) return;
    if (!auth.isAuthenticated) {
      navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
    } else if (!waiting && !failed && userProfile && !userProfile.isSignupCompleted) {
      navigation.reset({ index: 0, routes: [{ name: isCompany ? 'ShareholdersOnly' : 'AccountType' }] });
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.isFetching, waiting, failed, userProfile, isCompany, navigation]);
  if (completed || kept) return <SignedInNavigator />;
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
      {waiting || !auth.isAuthenticated || (!failed && userProfile) ? (
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
