import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { SIGNUP_COMPLETION_FAILED, SIGNUP_LOAD_FAILED, SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { canOpen } from '../constants/ui/destinations';
import { getCompanies, getCompany } from '../services/companies';
import { getUserProfiles, updateUserProfileCompletion } from '../services/users';
import type { AccountRole, ReviewData } from '../types';
import { apiErrorSentence, describeFailure, unansweredSentence } from '../utils/errors';
import { useApiClient } from './useApiClient';
import { useFinancialProfile } from './useFinancialProfile';

export function useSignupReview(role: AccountRole, onComplete: () => Promise<void> | void) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const isCompany = canOpen(role, 'company');

  const userProfileQuery = useQuery({
    queryKey: ['userProfiles'],
    queryFn: () => getUserProfiles(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const userProfile = userProfileQuery.data?.data?.results?.[0] || null;

  const { financialProfile, isLoading: financialProfileLoading, error: financialProfileError } = useFinancialProfile();

  const companyQuery = useQuery({
    queryKey: ['signup', 'company'],
    queryFn: () => getCompanies(apiClient),
    enabled: isCompany,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const selectedUuid = isCompany ? companyQuery.data?.data.results[0]?.uuid : undefined;
  const detailQuery = useQuery({
    queryKey: ['signup', 'company-detail', selectedUuid],
    queryFn: () => getCompany(apiClient, selectedUuid!),
    enabled: Boolean(selectedUuid),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });
  const company = selectedUuid && detailQuery.data?.data.uuid === selectedUuid ? detailQuery.data.data : null;

  const data: ReviewData = {
    userProfile,
    financialProfile: isCompany ? null : financialProfile,
  };

  const isLoading = Boolean(
    userProfileQuery.isLoading ||
    (!isCompany && financialProfileLoading) ||
    (isCompany && (companyQuery.isLoading || detailQuery.isLoading)),
  );

  const loadFailure =
    userProfileQuery.error ?? (isCompany ? (companyQuery.error ?? detailQuery.error) : financialProfileError);
  const error = loadFailure
    ? apiErrorSentence(loadFailure, SIGNUP_LOAD_FAILED, SIGNUP_LOAD_FAILED)
    : isCompany && selectedUuid && detailQuery.isSuccess && !company
      ? 'Company details did not match the selected company. Please try again.'
      : null;

  const canCompleteSignup =
    !isLoading && !error && (isCompany ? Boolean(userProfile && company) : Boolean(userProfile && financialProfile));

  const completeSignupMutation = useMutation({
    mutationFn: async () => {
      if (!userProfile) throw new Error('No user profile found');

      const profileUpdateResponse = await updateUserProfileCompletion(apiClient, userProfile.uuid, {
        termsAndConditions: true,
        isSignupCompleted: true,
      });

      return profileUpdateResponse;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
      await onComplete();
    },
    onError: (error) => {
      console.error(`Signup completion failed: ${describeFailure(error)}`);
    },
  });

  const completeSignup = () => {
    if (canCompleteSignup) {
      completeSignupMutation.mutate();
    }
  };

  const retryLoad = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['userProfiles'] }),
      ...(isCompany ? [queryClient.invalidateQueries({ queryKey: ['signup', 'company'] })] : []),
      ...(!isCompany ? [queryClient.invalidateQueries({ queryKey: ['financialProfiles'] })] : []),
      ...(selectedUuid
        ? [queryClient.invalidateQueries({ queryKey: ['signup', 'company-detail', selectedUuid] })]
        : []),
    ]);
  }, [queryClient, isCompany, selectedUuid]);

  return {
    data,
    company,
    isCompany,
    isLoading,
    error,
    completionError: completeSignupMutation.isError
      ? (unansweredSentence(completeSignupMutation.error, SIGNUP_NETWORK_ERROR) ?? SIGNUP_COMPLETION_FAILED)
      : null,
    completeSignup,
    isSubmitting: completeSignupMutation.isPending,
    canCompleteSignup,
    retryLoad,
  };
}
