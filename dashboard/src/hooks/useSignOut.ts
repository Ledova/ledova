import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { signout } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { AUTH_QUERY_KEY } from './useAuth';

export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => signout(apiClient),
    onSettled: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      queryClient.clear();
      navigate('/signin');
    },
  });

  return { signOut: () => mutation.mutate(), isSigningOut: mutation.isPending };
}
