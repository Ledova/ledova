import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIdentityVerificationToken,
  readIdentityVerification,
  useIdentityVerificationStatus,
  USER_PROFILES_QUERY_KEY,
  IDENTITY_VERIFICATION_QUERY_KEY,
} from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { getSessionEpoch, subscribeSession } from '../services/sessionScope';

export function useIdentityVerification(enabled = true) {
  const queryClient = useQueryClient();
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const submission = useMemo(() => ({ epoch, justSubmitted: false }), [epoch]);
  const scope = useMemo(
    () => ({
      enabled,
      epoch,
      generation: 0,
      disposed: false,
      launching: false,
      sdkError: null as string | null,
      accessToken: null as string | null,
      formUrl: null as string | null,
    }),
    [enabled, epoch],
  );
  const current = useRef(scope);
  // eslint-disable-next-line react-hooks/refs
  current.current = scope;
  const isCurrent = useCallback(
    () => scope.enabled && !scope.disposed && current.current === scope && scope.epoch === getSessionEpoch(),
    [scope],
  );

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    scope.disposed = false;
    return () => {
      scope.disposed = true;
      scope.generation++;
      scope.accessToken = null;
      scope.formUrl = null;
    };
  }, [scope]);

  const { justSubmitted } = submission;
  const statusQuery = useIdentityVerificationStatus(justSubmitted);

  const tokenMutation = useMutation({
    mutationFn: async () => {
      const response = await getIdentityVerificationToken(apiClient);
      return response.data;
    },
  });

  const status = statusQuery.data;
  const { isVerified, needsRetry, isPending, isOnHold, isRejected, hasSubmitted } = readIdentityVerification(
    status,
    justSubmitted,
  );

  useEffect(() => {
    if (!scope.disposed && submission.epoch === getSessionEpoch() && justSubmitted && (isVerified || isRejected)) {
      // eslint-disable-next-line react-hooks/immutability
      submission.justSubmitted = false;
      render();
      queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY });
    }
  }, [justSubmitted, isVerified, isRejected, queryClient, scope, submission]);

  // eslint-disable-next-line react-hooks/refs
  const showVerificationForm = isCurrent() && (!!scope.accessToken || !!scope.formUrl);

  const closeFormModal = useCallback(() => {
    if (!isCurrent()) return;
    // eslint-disable-next-line react-hooks/immutability
    scope.generation++;
    scope.launching = false;
    scope.accessToken = null;
    scope.formUrl = null;
    render();
  }, [scope, isCurrent]);

  const handleFormComplete = useCallback(() => {
    if (!isCurrent()) return;
    closeFormModal();
    // eslint-disable-next-line react-hooks/immutability
    submission.justSubmitted = true;
    render();
  }, [submission, isCurrent, closeFormModal]);

  const launchVerification = useCallback(async () => {
    if (!isCurrent() || scope.launching) return;
    // eslint-disable-next-line react-hooks/immutability
    const generation = ++scope.generation;
    const currentLaunch = () => isCurrent() && scope.generation === generation;
    scope.launching = true;
    scope.sdkError = null;
    render();
    try {
      const data = await tokenMutation.mutateAsync();
      if (!currentLaunch()) return;
      queryClient.invalidateQueries({ queryKey: IDENTITY_VERIFICATION_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY });
      scope.formUrl = data?.formUrl ?? null;
      scope.accessToken = scope.formUrl ? null : (data?.accessToken ?? null);
    } catch (error: unknown) {
      if (!currentLaunch()) return;
      scope.sdkError = error instanceof Error ? error.message : 'Failed to initialize verification';
    } finally {
      if (currentLaunch()) {
        scope.launching = false;
        render();
      }
    }
  }, [tokenMutation, queryClient, scope, isCurrent]);

  const resetState = useCallback(() => {
    if (!isCurrent()) return;
    closeFormModal();
    // eslint-disable-next-line react-hooks/immutability
    scope.sdkError = null;
    // eslint-disable-next-line react-hooks/immutability
    submission.justSubmitted = false;
    render();
  }, [scope, submission, isCurrent, closeFormModal]);

  return {
    status,
    isLoadingStatus: statusQuery.isLoading,

    isVerified,
    needsRetry,
    isPending,
    isOnHold,
    isRejected,
    hasSubmitted,

    launchVerification,
    isLaunching: scope.launching,

    accessToken: scope.accessToken,
    formUrl: scope.formUrl,
    formSessionEpoch: showVerificationForm ? scope.epoch : null,
    showVerificationForm,
    handleFormComplete,
    closeFormModal,

    justSubmitted,
    sdkError: scope.sdkError,
    resetState,
  };
}
