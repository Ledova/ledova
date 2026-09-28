import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { signout, AUTH_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

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
