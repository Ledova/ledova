import { clearSessionQueries } from '@hooks/session';
import { SIGNIN_PATH } from '@utils/paths';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { signout } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => signout(apiClient),
    onSettled: () => {
      clearSessionQueries(queryClient);
      navigate(SIGNIN_PATH);
    },
  });

  return { signOut: () => mutation.mutate(), isSigningOut: mutation.isPending };
}
