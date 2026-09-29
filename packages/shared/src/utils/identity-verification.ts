import type { IdentityVerificationStatus } from '../types';

export function readIdentityVerification(status: IdentityVerificationStatus | undefined, justSubmitted: boolean) {
  const isVerified = status?.isVerified ?? false;
  const needsRetry = status?.needsRetry ?? false;
  const isPending = !!status && ['pending', 'queued'].includes(status.status ?? '') && !status.isVerified;
  const isOnHold = !!status && status.status === 'onHold' && !status.isVerified;
  const isRejected = !!status && status.reviewAnswer === 'RED' && !status.isVerified && !status.needsRetry;
  const hasSubmitted = !!status && ['pending', 'queued', 'onHold'].includes(status.status ?? '') && !status.isVerified;

  const showPendingBanner = (justSubmitted || hasSubmitted) && !isVerified && !isRejected;
  const showRetryBanner = needsRetry && !isVerified && !justSubmitted;

  return {
    isVerified,
    needsRetry,
    hasApplicant: !!status?.applicantId,
    isPending,
    isOnHold,
    isRejected,
    hasSubmitted,
    showPendingBanner,
    showOnHoldBanner: isOnHold && !justSubmitted,
    showRejectedBanner: isRejected && !justSubmitted,
    showRetryBanner,
    showForm: !isVerified && !showPendingBanner && !showRetryBanner,
    showContinue: isVerified || hasSubmitted || justSubmitted,
    showSkip: !isVerified && !hasSubmitted && !justSubmitted,
  };
}
