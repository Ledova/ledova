import { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { describeFailure, signout } from '@ledova/shared';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { apiClient } from '../services/apiClient';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';

export function useSignOut() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    try {
      await notificationsService.unregisterToken();
      await signout(apiClient);
    } catch (error) {
      console.error(`Sign-out API call failed: ${describeFailure(error)}`);
    } finally {
      const retired = await clearTokens().then(
        () => true,
        () => false,
      );

      queryClient.clear();
      queryClient.removeQueries();
      queryClient.resetQueries();

      navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
      setSigningOut(false);
      if (!retired) {
        Alert.alert(
          'Sign-Out Warning',
          'You are signed out, but this device could not confirm that your saved sign-in was removed. If Ledova opens signed in, sign out again.',
        );
      }
    }
  };
  return { signOut, signingOut };
}
