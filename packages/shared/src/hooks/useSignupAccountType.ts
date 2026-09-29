import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getUserAccount, setAccountRole } from '../services/userAccount';
import type { AccountRole } from '../types';
import { apiErrorSentence, describeFailure } from '../utils/errors';
import { useApiClient } from './useApiClient';

type SignupRole = Exclude<AccountRole, 'both'>;

export function useSignupAccountType() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data: accountResponse } = useQuery({
    queryKey: ['userAccount'],
    queryFn: () => getUserAccount(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const account = accountResponse?.data ?? null;

  const updateRoleMutation = useMutation({
    mutationFn: (role: SignupRole) => setAccountRole(apiClient, account!.uuid, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userAccount'] });
      queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
    },
  });

  const chooseRole = async (role: SignupRole, onChosen: () => void) => {
    if (!account || isSubmitting) return;

    setIsSubmitting(true);
    setError('');
    try {
      await updateRoleMutation.mutateAsync(role);
      onChosen();
    } catch (failure) {
      console.error(`Failed to update account role: ${describeFailure(failure)}`);
      setError(
        (failure as { response?: unknown })?.response
          ? apiErrorSentence(failure, 'We could not save your account type. Please try again.')
          : 'Network error. Please check your connection.',
      );
      setIsSubmitting(false);
    }
  };

  return { account, isSubmitting, error, chooseRole };
}
