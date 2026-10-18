import { resetSessionQueries } from '@hooks/session';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEmailVerification } from '@ledova/shared';

export const useSignupEmailConfirmation = () => {
  const queryClient = useQueryClient();
  const [email] = useState(() => localStorage.getItem('signup_email') || '');

  return useEmailVerification(email, async () => {
    localStorage.removeItem('signup_email');

    await resetSessionQueries(queryClient);
  });
};
