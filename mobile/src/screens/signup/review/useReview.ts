import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

import { useSignupReview } from '@ledova/shared';
import { useRole } from '../../../hooks/useRole';

export const useReview = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const { role } = useRole();

  return useSignupReview(role, () => {
    queryClient.invalidateQueries({ queryKey: ['userProfiles'] });

    navigation.reset({
      index: 0,
      routes: [{ name: 'MainApp' }],
    });
  });
};
