import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AUTH_QUERY_KEY, useEmailVerification } from '@ledova/shared';

export const useSignupEmailConfirmation = () => {
  const queryClient = useQueryClient();
  const [email] = useState(() => localStorage.getItem('signup_email') || '');

  return useEmailVerification(email, async () => {
    localStorage.removeItem('signup_email');

    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== AUTH_QUERY_KEY[0] });
    await queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true });
  });
};
