import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { AUTH_QUERY_KEY, canOpen, landingFor, useSignupReview } from '@ledova/shared';
import { useRole } from '@hooks/useRole';

export const useReview = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useRole();

  return useSignupReview(role, async (guard) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['userProfiles'] }, { throwOnError: true }),
      queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true }, { throwOnError: true }),
    ]);
    guard();
    navigate(canOpen(role, 'company') ? '/company/dashboard' : landingFor(role));
  });
};
