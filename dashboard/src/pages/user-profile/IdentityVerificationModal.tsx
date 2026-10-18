import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WarningIcon, CheckCircleIcon, ClockCountdownIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { useIdentityVerification } from '@hooks/useIdentityVerification';
import { Modal, ModalActions } from '@components/Modal';
import { PageAction } from '@components/Page';

interface IdentityVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function Outcome({
  icon,
  title,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className={`flex items-center gap-2 text-sm font-medium ${tone}`}>
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Reasons({ labels }: { labels?: string[] | null }) {
  if (!labels || labels.length === 0) return null;
  return (
    <div className="pt-2">
      <p className="text-xs text-text-muted uppercase mb-1">Reasons:</p>
      {labels.map((label, index) => (
        <p key={index} className="text-sm text-text-secondary mt-1">
          &bull; {label}
        </p>
      ))}
    </div>
  );
}

export function IdentityVerificationModal({ isOpen, onClose }: IdentityVerificationModalProps) {
  const queryClient = useQueryClient();

  const {
    status,
    isLoadingStatus,
    isVerified,
    showPendingBanner,
    showOnHoldBanner,
    showRejectedBanner,
    showRetryBanner,
    showForm,
    launchVerification,
    formUrl,
    sdkActive,
    justSubmitted,
    verificationError,
    isLaunching,
    resetState,
  } = useIdentityVerification();

  useEffect(() => {
    if (justSubmitted && !isVerified) {
      const timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['userProfiles'] });
        onClose();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [justSubmitted, isVerified, queryClient, onClose]);

  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  const canStart = showForm && !isLoadingStatus && !sdkActive && !formUrl;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Identity Verification" size="lg" fullHeight={!!formUrl}>
      <div className="space-y-4">
        {(isLoadingStatus || isLaunching) && (
          <div className="flex flex-col items-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-light"></div>
            <p className="text-sm text-text-muted mt-4">
              {isLaunching ? 'Preparing verification...' : 'Loading status...'}
            </p>
          </div>
        )}

        {isVerified && (
          <Outcome
            icon={<CheckCircleIcon size={ICON_MD} weight="fill" />}
            title="Already Verified"
            tone="text-success-light"
          >
            <p className="text-sm text-text-secondary">Your identity has been verified successfully.</p>
          </Outcome>
        )}

        {showPendingBanner && (
          <Outcome
            icon={<CheckCircleIcon size={ICON_MD} weight="fill" />}
            title="Verification Submitted"
            tone="text-brand-light"
          >
            <p className="text-sm text-text-secondary">
              Your documents have been submitted. We&apos;ll review them shortly and notify you of the result.
            </p>
          </Outcome>
        )}

        {showOnHoldBanner && (
          <Outcome icon={<ClockCountdownIcon size={ICON_MD} />} title="Verification On Hold" tone="text-warning-light">
            <p className="text-sm text-text-secondary">
              Your verification is currently on hold. We may need additional information. Please check back later or
              contact support.
            </p>
          </Outcome>
        )}

        {showRejectedBanner && (
          <Outcome icon={<WarningIcon size={ICON_MD} />} title="Verification Rejected" tone="text-error-light">
            <p className="text-sm text-text-secondary">
              Unfortunately, your verification was not approved. You may retry with different documents or contact
              support for assistance.
            </p>
            <Reasons labels={status?.rejectionLabels} />
          </Outcome>
        )}

        {showRetryBanner && (
          <Outcome icon={<ArrowCounterClockwiseIcon size={ICON_MD} />} title="Retry Needed" tone="text-warning-light">
            <p className="text-sm text-text-secondary">
              Your previous verification attempt needs to be retried. Please try again with clearer documents.
            </p>
            <Reasons labels={status?.rejectionLabels} />
          </Outcome>
        )}

        {verificationError && (
          <p className="flex items-start gap-2 text-sm text-error-light" role="alert">
            <WarningIcon size={ICON_MD} className="flex-shrink-0" />
            {verificationError}
          </p>
        )}

        {canStart && !isLaunching && (
          <p className="text-sm text-text-muted">
            Verify your identity to comply with financial regulations and unlock full account features.
          </p>
        )}

        {showForm && !isLoadingStatus && !formUrl && <div id="sumsub-profile-websdk-container"></div>}

        {formUrl && (
          <iframe
            src={formUrl}
            title="Identity Verification"
            className="w-full rounded-lg border border-border"
            style={{ height: '800px' }}
            allow="camera; microphone"
          />
        )}

        <ModalActions>
          <PageAction label="Close" onClick={onClose} />
          {canStart && (
            <PageAction
              label={isLaunching ? 'Preparing...' : 'Start Verification'}
              primary
              onClick={() => launchVerification('#sumsub-profile-websdk-container')}
              disabled={isLaunching}
            />
          )}
          {showRetryBanner && (
            <PageAction
              label={isLaunching ? 'Preparing...' : 'Retry Verification'}
              primary
              onClick={() => launchVerification('#sumsub-profile-websdk-container')}
              disabled={isLaunching}
            />
          )}
        </ModalActions>
      </div>
    </Modal>
  );
}
