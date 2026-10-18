import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

import { useSignupReview, USER_PROFILES_QUERY_KEY } from '@ledova/shared';
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
      await queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY }, { throwOnError: true });
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
