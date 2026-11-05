import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

import { AUTH_QUERY_KEY, useSignupReview, USER_PROFILES_QUERY_KEY } from '@ledova/shared';
import { useRole } from '../../../hooks/useRole';
import { orderSubmissionSession } from '../../../services/orderSubmissions';
import { randomUUID } from 'expo-crypto';

export const useReview = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const { role } = useRole();

  return useSignupReview(
    role,
    async (guard) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY }, { throwOnError: true }),
        queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true }, { throwOnError: true }),
      ]);
      guard();
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainApp' }],
      });
    },
    orderSubmissionSession,
    randomUUID,
  );
};
