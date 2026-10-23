import { invitationDestination } from '@utils/memberInvitation';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { AUTH_QUERY_KEY, canOpen, landingFor, useSignupReview, USER_PROFILES_QUERY_KEY } from '@ledova/shared';
import { useRole } from '@hooks/useRole';

export const useReview = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useRole();

  return useSignupReview(role, async (guard) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY }, { throwOnError: true }),
      queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true }, { throwOnError: true }),
    ]);
    guard();
    navigate(invitationDestination(canOpen(role, 'company') ? COMPANY_DASHBOARD_PATH : landingFor(role)));
  });
};
