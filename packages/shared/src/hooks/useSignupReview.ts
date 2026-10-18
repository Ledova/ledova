import { AUTH_QUERY_ROOT } from './useAuth';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { SIGNUP_COMPLETION_FAILED, SIGNUP_LOAD_FAILED, SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { canOpen } from '../constants/ui/destinations';
import { getCompanies, getCompany } from '../services/companies';
import { getUserProfiles, updateUserProfileCompletion } from '../services/users';
import type { AccountRole, ReviewData } from '../types';
import { apiErrorSentence, describeFailure } from '../utils/errors';
import { useApiClient } from './useApiClient';
import { useFinancialProfile, FINANCIAL_PROFILES_QUERY_KEY } from './useFinancialProfile';
import { useOperator } from './useOperator';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useSignupCompanyAuthority, SIGNUP_AUTHORITY_QUERY_KEY } from './useSignupCompanyAuthority';

export const USER_PROFILES_QUERY_KEY = ['userProfiles'] as const;
export const SIGNUP_COMPANY_QUERY_KEY = ['signup', 'company'] as const;
export const SIGNUP_COMPANY_DETAIL_QUERY_KEY = ['signup', 'company-detail'] as const;

export function signupCompanyDetailKey(uuid: string | null | undefined) {
  return [...SIGNUP_COMPANY_DETAIL_QUERY_KEY, uuid];
}

export function useSignupReview(
  role: AccountRole,
  onComplete: (guard: () => void) => Promise<void> | void,
  session?: OrderSubmissionSession,
  newKey?: () => string,
) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const isCompany = canOpen(role, 'company');

  const userProfileQuery = useQuery({
    queryKey: USER_PROFILES_QUERY_KEY,
    queryFn: () => getUserProfiles(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const userProfile = userProfileQuery.data?.data?.results?.[0] || null;

  const { financialProfile, isLoading: financialProfileLoading, error: financialProfileError } = useFinancialProfile();

  const companyQuery = useQuery({
    queryKey: SIGNUP_COMPANY_QUERY_KEY,
    queryFn: () => getCompanies(apiClient),
    enabled: isCompany,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const selectedUuid = isCompany ? companyQuery.data?.data.results[0]?.uuid : undefined;
  const detailQuery = useQuery({
    queryKey: signupCompanyDetailKey(selectedUuid),
    queryFn: () => getCompany(apiClient, selectedUuid!),
    enabled: Boolean(selectedUuid),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });
  const company = selectedUuid && detailQuery.data?.data.uuid === selectedUuid ? detailQuery.data.data : null;
  const operatorQuery = useOperator({ enabled: isCompany });
  const identityRequired = Boolean(
    isCompany && operatorQuery.data?.data?.issuerKycRequired && userProfile && !userProfile.isIdVerified,
  );
  const authority = useSignupCompanyAuthority(
    company,
    userProfile,
    isCompany && !!company && !!userProfile,
    session,
    newKey,
  );

  const data: ReviewData = {
    userProfile,
    financialProfile: isCompany ? null : financialProfile,
  };

  const isLoading = Boolean(
    userProfileQuery.isLoading ||
    (!isCompany && financialProfileLoading) ||
    (isCompany &&
      (companyQuery.isLoading || detailQuery.isLoading || operatorQuery.isLoading || authority.authorityLoading)),
  );

  const loadFailure =
    userProfileQuery.error ?? (isCompany ? (companyQuery.error ?? detailQuery.error) : financialProfileError);
  const error = loadFailure
    ? apiErrorSentence(loadFailure, SIGNUP_LOAD_FAILED, SIGNUP_LOAD_FAILED)
    : isCompany && selectedUuid && detailQuery.isSuccess && !company
      ? 'Company details did not match the selected company. Please try again.'
      : null;

  const canCompleteSignup =
    !isLoading &&
    authority.completionOwnerReady &&
    !error &&
    !authority.authorityError &&
    (isCompany
      ? Boolean(userProfile && company && authority.canEstablishAuthority && !identityRequired)
      : Boolean(userProfile && financialProfile));

  const completeSignupMutation = useMutation({
    mutationFn: async () => {
      if (!userProfile) throw new Error('No user profile found');
      if (isCompany) await authority.establishAuthority();
      authority.guardCommandCompletion();

      const profileUpdateResponse = await updateUserProfileCompletion(
        apiClient,
        userProfile.uuid,
        {
          termsAndConditions: true,
          isSignupCompleted: true,
        },
        { ledovaSubmissionGuard: authority.guardCompletion },
      );
      authority.guardCompletion();

      return profileUpdateResponse;
    },
    onSuccess: async () => {
      authority.guardCompletion();
      queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
      await onComplete(authority.guardCompletion);
    },
    onError: async (error) => {
      console.error(`Signup completion failed: ${describeFailure(error)}`);
      if (isCompany) await authority.refreshAuthority().catch(() => undefined);
    },
  });

  const completeSignup = async () => {
    if (canCompleteSignup) {
      await completeSignupMutation.mutateAsync();
    }
  };

  const retryLoad = useCallback(async () => {
    authority.clearAuthorityError();
    completeSignupMutation.reset();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY }),
      ...(isCompany ? [queryClient.invalidateQueries({ queryKey: SIGNUP_COMPANY_QUERY_KEY })] : []),
      ...(!isCompany ? [queryClient.invalidateQueries({ queryKey: FINANCIAL_PROFILES_QUERY_KEY })] : []),
      ...(selectedUuid ? [queryClient.invalidateQueries({ queryKey: signupCompanyDetailKey(selectedUuid) })] : []),
      ...(isCompany
        ? [
            queryClient.invalidateQueries({ queryKey: AUTH_QUERY_ROOT }),
            queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: SIGNUP_AUTHORITY_QUERY_KEY }),
          ]
        : []),
    ]);
  }, [queryClient, isCompany, selectedUuid, authority, completeSignupMutation]);

  return {
    ...authority,
    data,
    company,
    isCompany,
    identityRequired,
    isLoading,
    error,
    completionError: completeSignupMutation.isError
      ? apiErrorSentence(completeSignupMutation.error, SIGNUP_COMPLETION_FAILED, SIGNUP_NETWORK_ERROR)
      : null,
    completeSignup,
    isSubmitting: completeSignupMutation.isPending,
    canCompleteSignup,
    retryLoad,
  };
}
