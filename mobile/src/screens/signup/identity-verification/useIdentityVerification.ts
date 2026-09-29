import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readIdentityVerification } from '@ledova/shared';
import { useIdentityVerification as useIdentityVerificationApi } from '../../../hooks/useIdentityVerification';

export const useIdentityVerification = (enabled = true) => {
  const [isContinuing, setIsContinuing] = useState(false);
  const queryClient = useQueryClient();

  const {
    status,
    isLoadingStatus,
    tokenError,
    isVerified,
    hasApplicant,
    refetchStatus,
    launchVerification,
    isLaunching,
    sdkError,
    justSubmitted,
    accessToken,
    formUrl,
    formSessionEpoch,
    showVerificationForm,
    handleFormComplete,
    closeFormModal,
  } = useIdentityVerificationApi(enabled);

  const { showPendingBanner, showOnHoldBanner, showRejectedBanner, showRetryBanner, showForm, showContinue, showSkip } =
    readIdentityVerification(status, justSubmitted);

  const prepareForNextScreen = async () => {
    setIsContinuing(true);
    try {
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['userProfiles'] });
      return true;
    } catch {
      return false;
    } finally {
      setIsContinuing(false);
    }
  };

  return {
    status,
    isLoadingStatus,
    isVerified,

    showPendingBanner,
    showOnHoldBanner,
    showRejectedBanner,
    showRetryBanner,
    showForm,
    showContinue,
    showSkip,

    tokenError,
    sdkError,

    launchVerification,
    prepareForNextScreen,

    isLaunching,
    isContinuing,

    hasApplicant,

    accessToken,
    formUrl,
    formSessionEpoch,
    showVerificationForm,
    handleFormComplete,
    closeFormModal,
  };
};
